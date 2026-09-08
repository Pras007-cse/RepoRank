import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import type { Category } from "@prisma/client";

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  const rl = rateLimit(`leaderboard:${ip}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  // "projects" is the primary ranking per the product spec (verified stars
  // received). global/trending/category rank *stargazing activity* and are
  // kept as a secondary "Top stargazers" tab, not the headline metric.
  const scope = searchParams.get("scope") ?? "projects";
  const category = searchParams.get("category")?.toUpperCase();
  const rawLimit = Number(searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : 50;

  if (scope === "projects") {
    return projectsScope(limit);
  }

  if (scope === "builders") {
    return buildersScope(limit);
  }

  if (scope === "global") {
    const users = await prisma.user.findMany({
      where: { contributionScore: { gt: 0 } },
      orderBy: { contributionScore: "desc" },
      take: limit,
      select: {
        id: true,
        name: true,
        githubLogin: true,
        image: true,
        contributionScore: true,
        rank: true,
      },
    });
    return NextResponse.json({ scope, users });
  }

  if (scope === "trending") {
    // Trending = most star-verification activity in the last 7 days.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const grouped = await prisma.activityEvent.groupBy({
      by: ["userId"],
      where: { type: "STAR_VERIFIED", createdAt: { gte: since } },
      _count: { userId: true },
      orderBy: { _count: { userId: "desc" } },
      take: limit,
    });
    const userIds = grouped.map((g) => g.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, githubLogin: true, image: true, contributionScore: true, rank: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const ranked = grouped
      .map((g: { userId: string; _count: { userId: number } }) => {
        const base = byId.get(g.userId);
        return base ? { ...base, recentStars: g._count.userId } : null;
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);
    return NextResponse.json({ scope, users: ranked });
  }

  if (scope === "category") {
    if (!category) {
      return NextResponse.json({ error: "category is required for scope=category" }, { status: 400 });
    }
    const stars = await prisma.star.findMany({
      where: { status: "VERIFIED", repository: { category: category as Category } },
      select: { userId: true, points: true },
    });
    const scoreByUser = new Map<string, number>();
    for (const s of stars) {
      scoreByUser.set(s.userId, (scoreByUser.get(s.userId) ?? 0) + s.points);
    }
    const userIds = [...scoreByUser.keys()];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, githubLogin: true, image: true },
    });
    const ranked = users
      .map((u: { id: string; name: string | null; githubLogin: string | null; image: string | null }) => ({
        ...u,
        categoryScore: scoreByUser.get(u.id) ?? 0,
      }))
      .sort((a: { categoryScore: number }, b: { categoryScore: number }) => b.categoryScore - a.categoryScore)
      .slice(0, limit);
    return NextResponse.json({ scope, category, users: ranked });
  }

  return NextResponse.json({ error: "Invalid scope. Use global | trending | category | projects | builders." }, { status: 400 });
}

/**
 * scope=projects — the PRIMARY ranking per the product spec: repositories
 * ranked by verified stars *received* from other verified builders. Claimed
 * and unclaimed projects both appear (the stars are real either way); only
 * a claimed project's stars roll up into its owner's builder ranking below.
 */
async function projectsScope(limit: number) {
  const grouped = await prisma.star.groupBy({
    by: ["repositoryId"],
    where: { status: "VERIFIED" },
    _count: { repositoryId: true },
    orderBy: { _count: { repositoryId: "desc" } },
    take: limit,
  });
  const repoIds: string[] = grouped.map((g: { repositoryId: string }) => g.repositoryId);
  const repos = await prisma.repository.findMany({
    where: { id: { in: repoIds } },
    select: {
      id: true,
      fullName: true,
      url: true,
      category: true,
      ownerUserId: true,
      ownerUser: { select: { githubLogin: true, name: true, image: true } },
    },
  });
  type ProjectRow = (typeof repos)[number];
  const byId = new Map<string, ProjectRow>(repos.map((r: ProjectRow) => [r.id, r]));
  const ranked = grouped
    .map((g: { repositoryId: string; _count: { repositoryId: number } }) => {
      const repo = byId.get(g.repositoryId);
      if (!repo) return null;
      return { ...repo, verifiedStarsReceived: g._count.repositoryId };
    })
    .filter((r: (ProjectRow & { verifiedStarsReceived: number }) | null): r is ProjectRow & { verifiedStarsReceived: number } => r !== null);
  return NextResponse.json({ scope: "projects", projects: ranked });
}

/**
 * scope=builders — verified owners ranked by the sum of verified stars
 * received across all of *their* claimed projects. Unclaimed projects'
 * stars don't roll up anywhere here — there's no verified owner to credit.
 */
async function buildersScope(limit: number) {
  const grouped = await prisma.star.groupBy({
    by: ["repositoryId"],
    where: { status: "VERIFIED", repository: { ownerUserId: { not: null } } },
    _count: { repositoryId: true },
  });
  const repoIds: string[] = grouped.map((g: { repositoryId: string }) => g.repositoryId);
  const repos = await prisma.repository.findMany({
    where: { id: { in: repoIds } },
    select: { id: true, ownerUserId: true },
  });
  const ownerByRepo = new Map<string, string>(
    repos.map((r: { id: string; ownerUserId: string | null }) => [r.id, r.ownerUserId as string])
  );

  const scoreByOwner = new Map<string, number>();
  for (const g of grouped as Array<{ repositoryId: string; _count: { repositoryId: number } }>) {
    const ownerId = ownerByRepo.get(g.repositoryId);
    if (!ownerId) continue;
    scoreByOwner.set(ownerId, (scoreByOwner.get(ownerId) ?? 0) + g._count.repositoryId);
  }

  const ownerIds = [...scoreByOwner.keys()];
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true, githubLogin: true, image: true },
  });
  const ranked = owners
    .map((o: { id: string; name: string | null; githubLogin: string | null; image: string | null }) => ({
      ...o,
      verifiedStarsReceived: scoreByOwner.get(o.id) ?? 0,
    }))
    .sort((a: { verifiedStarsReceived: number }, b: { verifiedStarsReceived: number }) => b.verifiedStarsReceived - a.verifiedStarsReceived)
    .slice(0, limit);
  return NextResponse.json({ scope: "builders", builders: ranked });
}
