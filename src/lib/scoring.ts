import { prisma } from "@/lib/prisma";
import { fetchStarredRepoIds, GitHubRateLimitError } from "@/lib/github";

/**
 * Detection-only star sync. This app never stars anything on GitHub on a
 * user's behalf — it only ever reads a *verified builder's* real public
 * starred list and reconciles it against registered repositories. GitHub
 * is the sole source of truth; nothing here trusts a client claim that a
 * star exists.
 *
 * Only builderVerified users are polled — an unverified GitHub identity
 * could belong to anyone, so its "stars" can't be attributed to a real
 * ProjectStar participant (see the identity-rule requirement this
 * implements).
 */

/** Re-syncs one verified builder's starred set against all registered repos. */
export async function syncBuilderStars(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.builderVerified || !user.githubLogin) return null;

  let starredRepoIds: Set<number>;
  try {
    starredRepoIds = await fetchStarredRepoIds(user.githubLogin);
  } catch (err) {
    if (err instanceof GitHubRateLimitError) return null; // retry next tick, don't penalize the user
    await prisma.activityEvent.create({
      data: {
        userId,
        type: "SYNC_ERROR",
        message: `GitHub API error while syncing starred repos: ${(err as Error).message}`,
      },
    });
    return null;
  }

  // Only registered repositories matter — anything else the user starred
  // (react, linux, whatever) is irrelevant noise per the product spec.
  const registeredRepos = await prisma.repository.findMany({
    where: { githubId: { in: [...starredRepoIds] } },
    select: { id: true, githubId: true, fullName: true, ownerUserId: true },
  });

  const currentlyActive = await prisma.star.findMany({
    where: { userId, status: "VERIFIED" },
    select: { repositoryId: true },
  });
  const currentlyActiveIds = new Set<string>(currentlyActive.map((s: { repositoryId: string }) => s.repositoryId));
  const newlyIntersecting = new Set<string>(registeredRepos.map((r: { id: string }) => r.id));

  let added = 0;
  let removed = 0;

  for (const repo of registeredRepos) {
    if (currentlyActiveIds.has(repo.id)) continue;
    if (repo.ownerUserId === userId) continue; // self-star: never counted, never even written

    await prisma.$transaction([
      prisma.star.upsert({
        where: { userId_repositoryId: { userId, repositoryId: repo.id } },
        create: { userId, repositoryId: repo.id, status: "VERIFIED", verifiedAt: new Date() },
        update: { status: "VERIFIED", verifiedAt: new Date(), lastCheckedAt: new Date() },
      }),
      prisma.activityEvent.create({
        data: {
          userId,
          repositoryId: repo.id,
          type: "STAR_VERIFIED",
          message: `Verified star on ${repo.fullName}.`,
        },
      }),
    ]);
    added += 1;
  }

  for (const repositoryId of currentlyActiveIds) {
    if (newlyIntersecting.has(repositoryId)) continue;
    await prisma.$transaction([
      prisma.star.update({
        where: { userId_repositoryId: { userId, repositoryId } },
        data: { status: "REMOVED", lastCheckedAt: new Date() },
      }),
      prisma.activityEvent.create({
        data: {
          userId,
          repositoryId,
          type: "STAR_REMOVED",
          message: "Star was removed on GitHub; contribution deducted.",
        },
      }),
    ]);
    removed += 1;
  }

  await prisma.user.update({ where: { id: userId }, data: { lastSyncedAt: new Date() } });
  if (added > 0 || removed > 0) {
    await recomputeUserScore(userId);
  }

  return { added, removed };
}

/** Legacy "stars given" score — kept as a secondary leaderboard alongside the new received-stars ranking. */
export async function recomputeUserScore(userId: string) {
  const agg = await prisma.star.aggregate({
    where: { userId, status: "VERIFIED" },
    _sum: { points: true },
  });
  const score = agg._sum.points ?? 0;
  await prisma.user.update({
    where: { id: userId },
    data: { contributionScore: score },
  });
  return score;
}

/** Recomputes global ranks for the legacy "stars given" leaderboard. */
export async function recomputeGlobalRanks() {
  const users = await prisma.user.findMany({
    where: { contributionScore: { gt: 0 } },
    orderBy: { contributionScore: "desc" },
    select: { id: true },
  });

  await prisma.$transaction(
    users.map((u: { id: string }, idx: number) =>
      prisma.user.update({ where: { id: u.id }, data: { rank: idx + 1 } })
    )
  );
}

/**
 * Batch sync pass, triggered by a scheduled job (cron / Vercel Cron / GitHub
 * Action) — the fallback to webhooks so star status never drifts far from
 * GitHub even if a delivery is missed. Processes the stalest-synced verified
 * builders first, in small batches to stay well within GitHub's rate limits.
 */
export async function runPeriodicRevalidation(batchSize = 50) {
  const users = await prisma.user.findMany({
    where: { builderVerified: true },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: batchSize,
    select: { id: true },
  });

  let usersProcessed = 0;
  for (const u of users) {
    const result = await syncBuilderStars(u.id);
    if (result) usersProcessed += 1;
  }
  await recomputeGlobalRanks();
  return { checked: users.length, usersProcessed };
}
