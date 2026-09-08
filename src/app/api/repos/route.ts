import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { searchRepositories, fetchRepoMetadata, parseRepoUrl, GitHubRateLimitError } from "@/lib/github";
import { inferCategory } from "@/lib/category";
import { rateLimit } from "@/lib/rateLimit";
import type { Category } from "@prisma/client";

const VALID_CATEGORIES = new Set([
  "WEB",
  "MOBILE",
  "AI_ML",
  "DEVOPS",
  "DATABASE",
  "SECURITY",
  "GAME_DEV",
  "CLI_TOOLING",
  "LIBRARY",
  "OTHER",
]);

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  const rl = rateLimit(`repos:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests, please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const language = searchParams.get("language")?.trim() || undefined;
  const category = searchParams.get("category")?.trim().toUpperCase();
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));

  try {
    // Live search against GitHub, then upsert into our cache so the
    // discovery feed can also be filtered by our own derived Category field.
    const results = await searchRepositories({ query, language, page, perPage: 24 });

    const upserted = await Promise.all(
      results.items.map(async (repo) => {
        const cat = inferCategory(repo.topics ?? [], repo.language);
        return prisma.repository.upsert({
          where: { githubId: repo.id },
          create: {
            githubId: repo.id,
            owner: repo.owner?.login ?? "",
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description ?? undefined,
            url: repo.html_url,
            language: repo.language ?? undefined,
            topics: repo.topics ?? [],
            category: cat,
            stargazersCount: repo.stargazers_count ?? 0,
          },
          update: {
            description: repo.description ?? undefined,
            language: repo.language ?? undefined,
            topics: repo.topics ?? [],
            stargazersCount: repo.stargazers_count ?? 0,
            lastFetchedAt: new Date(),
          },
        });
      })
    );

    const filtered =
      category && VALID_CATEGORIES.has(category)
        ? upserted.filter((r) => r.category === (category as Category))
        : upserted;

    return NextResponse.json({
      total: results.total_count,
      page,
      items: filtered,
    });
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      // Fall back to serving cached repos from our DB so the feed still works.
      const cached = await prisma.repository.findMany({
        where: {
          ...(language ? { language } : {}),
          ...(category && VALID_CATEGORIES.has(category) ? { category: category as Category } : {}),
          ...(query
            ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] }
            : {}),
        },
        orderBy: { stargazersCount: "desc" },
        take: 24,
      });
      return NextResponse.json({
        total: cached.length,
        page: 1,
        items: cached,
        notice: "GitHub API rate limit reached; showing cached results.",
        rateLimitResetAt: err.resetAt,
      });
    }
    console.error("GET /api/repos error", err);
    return NextResponse.json({ error: "Failed to fetch repositories." }, { status: 502 });
  }
}

/**
 * POST /api/repos — "paste your GitHub repository URL" project submission.
 * Deliberately unauthenticated: repository submission is not repository
 * ownership. This registers the repo (unclaimed unless its real GitHub
 * owner already matches an existing verified builder) and returns it
 * immediately — no login, no GitHub App, no repo permissions to do this.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  const rl = rateLimit(`submit-repo:${ip}`, { limit: 10, windowMs: 3600_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many submissions from this network, try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.repoUrl || typeof body.repoUrl !== "string") {
    return NextResponse.json({ error: "repoUrl is required." }, { status: 400 });
  }
  const parsed = parseRepoUrl(body.repoUrl);
  if (!parsed) {
    return NextResponse.json({ error: "repoUrl must look like https://github.com/owner/repo" }, { status: 400 });
  }

  try {
    const repo = await fetchRepoMetadata(parsed.owner, parsed.repo);
    if (repo.private) {
      return NextResponse.json({ error: "Private repositories can't be registered." }, { status: 422 });
    }

    // If this repo's real GitHub owner already has a verified builder
    // identity in our system, claim it automatically — no reason to make
    // someone re-verify just because they submitted their own project
    // through this anonymous flow instead of the claim flow directly.
    const existingOwner = await prisma.user.findFirst({
      where: { githubLogin: repo.owner.login, builderVerified: true },
      select: { id: true },
    });

    const cat = inferCategory(repo.topics ?? [], repo.language);
    const project = await prisma.repository.upsert({
      where: { githubId: repo.id },
      create: {
        githubId: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description ?? undefined,
        url: repo.html_url,
        language: repo.language ?? undefined,
        topics: repo.topics ?? [],
        category: cat,
        stargazersCount: repo.stargazers_count ?? 0,
        ...(existingOwner ? { ownerUserId: existingOwner.id, claimedAt: new Date() } : {}),
      },
      update: {
        description: repo.description ?? undefined,
        language: repo.language ?? undefined,
        topics: repo.topics ?? [],
        stargazersCount: repo.stargazers_count ?? 0,
        lastFetchedAt: new Date(),
      },
    });

    return NextResponse.json({
      project,
      claimed: project.ownerUserId !== null,
      claimInstructions:
        project.ownerUserId === null
          ? `This project is unclaimed. If you own ${repo.full_name}, verify at /api/builder/verify to claim it.`
          : undefined,
    });
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      return NextResponse.json({ error: "GitHub API rate limit reached, try again shortly." }, { status: 429 });
    }
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    }
    console.error("POST /api/repos error", err);
    return NextResponse.json({ error: "Failed to register project." }, { status: 500 });
  }
}
