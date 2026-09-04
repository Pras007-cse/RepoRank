import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { searchRepositories, GitHubRateLimitError } from "@/lib/github";
import { inferCategory } from "@/lib/category";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
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
  const ip = getClientIp(req);
  const rl = rateLimit(`repos:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests, please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q")?.trim() ?? "").slice(0, 200);
  const language = searchParams.get("language")?.trim().slice(0, 50) || undefined;
  const category = searchParams.get("category")?.trim().toUpperCase();
  const rawPage = Number(searchParams.get("page") ?? 1);
  const page = Number.isFinite(rawPage) ? Math.min(100, Math.max(1, Math.trunc(rawPage))) : 1;

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
