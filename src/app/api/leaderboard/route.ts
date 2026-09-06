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
  const scope = searchParams.get("scope") ?? "global"; // global | trending | category
  const category = searchParams.get("category")?.toUpperCase();
  const limit = Math.min(100, Number(searchParams.get("limit") ?? 50));

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

  return NextResponse.json({ error: "Invalid scope. Use global | trending | category." }, { status: 400 });
}
