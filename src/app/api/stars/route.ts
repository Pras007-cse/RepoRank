import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserOctokit, starRepoForUser, isRepoStarredByUser, GitHubRateLimitError } from "@/lib/github";
import { recomputeUserScore, recomputeGlobalRanks } from "@/lib/scoring";
import { rateLimit } from "@/lib/rateLimit";
import { z } from "zod";

const bodySchema = z.object({
  repositoryId: z.string().cuid(),
});

/** GET /api/stars — the current user's verified + pending stars */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const stars = await prisma.star.findMany({
    where: { userId },
    include: { repository: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ stars });
}

/**
 * POST /api/stars — "Star on GitHub" action.
 * 1. Actually stars the repo on the user's real GitHub account (via their token).
 * 2. Immediately re-checks with GitHub that the star is active (source of truth).
 * 3. Records a VERIFIED Star row (idempotent — unique on userId+repositoryId,
 *    so duplicate requests for the same repo never double count).
 * 4. Recomputes the user's contribution score + global ranks.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const rl = rateLimit(`star:${userId}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many star requests, try again shortly." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "repositoryId is required." }, { status: 400 });
  }
  const { repositoryId } = parsed.data;

  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) {
    return NextResponse.json({ error: "Repository not found." }, { status: 404 });
  }

  const octokit = await getUserOctokit(userId);
  if (!octokit) {
    return NextResponse.json(
      { error: "Your GitHub connection is missing or expired. Please sign in again." },
      { status: 401 }
    );
  }

  try {
    // Prevent duplicate counting: if we already have a verified star, no-op.
    const existing = await prisma.star.findUnique({
      where: { userId_repositoryId: { userId, repositoryId } },
    });
    if (existing?.status === "VERIFIED") {
      return NextResponse.json({ star: existing, alreadyStarred: true });
    }

    await starRepoForUser(octokit, repository.owner, repository.name);
    const confirmed = await isRepoStarredByUser(octokit, repository.owner, repository.name);

    if (!confirmed) {
      return NextResponse.json(
        { error: "GitHub did not confirm the star. Please try again." },
        { status: 502 }
      );
    }

    const now = new Date();
    const star = await prisma.star.upsert({
      where: { userId_repositoryId: { userId, repositoryId } },
      create: {
        userId,
        repositoryId,
        status: "VERIFIED",
        verifiedAt: now,
        lastCheckedAt: now,
        starredAt: now,
      },
      update: {
        status: "VERIFIED",
        verifiedAt: now,
        lastCheckedAt: now,
      },
    });

    await prisma.activityEvent.create({
      data: {
        userId,
        repositoryId,
        type: "STAR_VERIFIED",
        message: `Starred and verified ${repository.fullName}.`,
      },
    });

    await recomputeUserScore(userId);
    await recomputeGlobalRanks();

    return NextResponse.json({ star });
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      return NextResponse.json(
        { error: "GitHub API rate limit reached, please try again later.", resetAt: err.resetAt },
        { status: 429 }
      );
    }
    console.error("POST /api/stars error", err);
    return NextResponse.json({ error: "Failed to star repository." }, { status: 502 });
  }
}
