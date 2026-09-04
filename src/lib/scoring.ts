import { prisma } from "@/lib/prisma";
import { getUserOctokit, isRepoStarredByUser, GitHubRateLimitError } from "@/lib/github";

/**
 * Re-verifies a single user's star on a single repository against GitHub,
 * and updates local state (Star.status, User.contributionScore, activity
 * log) to match. This is the only place that should ever flip a Star
 * between VERIFIED and REMOVED — keeping GitHub as the single source of
 * truth and guaranteeing unstarred repos stop counting immediately.
 */
export async function reverifyStar(userId: string, repositoryId: string) {
  const star = await prisma.star.findUnique({
    where: { userId_repositoryId: { userId, repositoryId } },
    include: { repository: true },
  });
  if (!star) return null;

  const octokit = await getUserOctokit(userId);
  if (!octokit) {
    // No usable token — leave status as-is, log it, try again later.
    await prisma.activityEvent.create({
      data: {
        userId,
        repositoryId,
        type: "SYNC_ERROR",
        message: "Missing or invalid GitHub token; could not re-verify star.",
      },
    });
    return star;
  }

  let stillStarred: boolean;
  try {
    stillStarred = await isRepoStarredByUser(
      octokit,
      star.repository.owner,
      star.repository.name
    );
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      // Don't penalize the user for our own rate limiting — just skip this cycle.
      return star;
    }
    await prisma.activityEvent.create({
      data: {
        userId,
        repositoryId,
        type: "SYNC_ERROR",
        message: `GitHub API error while re-verifying star: ${(err as Error).message}`,
      },
    });
    return star;
  }

  const now = new Date();

  if (stillStarred && star.status !== "VERIFIED") {
    await prisma.$transaction([
      prisma.star.update({
        where: { id: star.id },
        data: { status: "VERIFIED", verifiedAt: now, lastCheckedAt: now },
      }),
      prisma.activityEvent.create({
        data: {
          userId,
          repositoryId,
          type: "STAR_VERIFIED",
          message: `Star on ${star.repository.fullName} verified.`,
        },
      }),
    ]);
    await recomputeUserScore(userId);
  } else if (!stillStarred && star.status !== "REMOVED") {
    // The user unstarred it on GitHub — remove the contribution immediately.
    await prisma.$transaction([
      prisma.star.update({
        where: { id: star.id },
        data: { status: "REMOVED", lastCheckedAt: now },
      }),
      prisma.activityEvent.create({
        data: {
          userId,
          repositoryId,
          type: "STAR_REMOVED",
          message: `Star on ${star.repository.fullName} was removed on GitHub; contribution deducted.`,
        },
      }),
    ]);
    await recomputeUserScore(userId);
  } else {
    await prisma.star.update({
      where: { id: star.id },
      data: { lastCheckedAt: now },
    });
  }

  return prisma.star.findUnique({ where: { id: star.id } });
}

/** Recomputes a user's cached contribution score from currently VERIFIED stars only. */
export async function recomputeUserScore(userId: string) {
  const agg = await prisma.star.aggregate({
    where: { userId, status: "VERIFIED" },
    _sum: { points: true },
  });
  const score = agg._sum.points ?? 0;
  await prisma.user.update({
    where: { id: userId },
    data: { contributionScore: score, lastSyncedAt: new Date() },
  });
  return score;
}

/**
 * Recomputes global ranks for all users based on cached contributionScore.
 * Cheap to run periodically since it only touches the User table.
 */
export async function recomputeGlobalRanks() {
  const users = await prisma.user.findMany({
    where: { contributionScore: { gt: 0 } },
    orderBy: { contributionScore: "desc" },
    select: { id: true, rank: true },
  });

  await prisma.$transaction(
    users.map((u: { id: string }, idx: number) =>
      prisma.user.update({ where: { id: u.id }, data: { rank: idx + 1 } })
    )
  );
}

/**
 * Batch re-verification pass, intended to be triggered by a scheduled job
 * (cron / Vercel Cron / GitHub Action) as a fallback to webhooks, so star
 * status never drifts far from GitHub even if a webhook delivery is missed.
 * Processes the stalest-checked stars first, in small batches to stay well
 * within GitHub's rate limits.
 */
export async function runPeriodicRevalidation(batchSize = 50) {
  const stars = await prisma.star.findMany({
    where: { status: { in: ["VERIFIED", "PENDING"] } },
    orderBy: { lastCheckedAt: "asc" },
    take: batchSize,
  });

  const affectedUsers = new Set<string>();
  for (const star of stars) {
    await reverifyStar(star.userId, star.repositoryId);
    affectedUsers.add(star.userId);
  }
  await recomputeGlobalRanks();
  return { checked: stars.length, users: affectedUsers.size };
}
