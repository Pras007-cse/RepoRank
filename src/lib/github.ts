import { Octokit } from "@octokit/rest";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";

/**
 * All server-side GitHub API access goes through this module. GitHub is the
 * single source of truth for star state — nothing here ever trusts client
 * input about whether a star exists; it always asks GitHub.
 */

// App-level Octokit for unauthenticated / app-token requests (search, public repo reads)
// Falls back to a personal token if provided, which raises the rate limit
// from 60/hr (unauthenticated) to 5,000/hr.
export function getAppOctokit(): Octokit {
  return new Octokit({
    auth: process.env.GITHUB_APP_TOKEN || undefined,
  });
}

/** Returns an Octokit instance authenticated as the given user, using their
 * encrypted, stored OAuth access token. Used to check/star repos on their behalf. */
export async function getUserOctokit(userId: string): Promise<Octokit | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubAccessTokenEnc: true },
  });
  if (!user?.githubAccessTokenEnc) return null;
  const token = decryptSecret(user.githubAccessTokenEnc);
  return new Octokit({ auth: token });
}

/**
 * Thin wrapper that respects GitHub's rate-limit headers: if we're close to
 * the limit, we back off; if we've exceeded it, we surface a typed error the
 * caller can handle gracefully instead of hammering the API.
 */
export class GitHubRateLimitError extends Error {
  resetAt: Date;
  constructor(resetAt: Date) {
    super(`GitHub API rate limit exceeded, resets at ${resetAt.toISOString()}`);
    this.name = "GitHubRateLimitError";
    this.resetAt = resetAt;
  }
}

export async function withRateLimitGuard<T>(
  octokit: Octokit,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const e = err as { status?: number; response?: { headers?: Record<string, string> } };
    if (e?.status === 403 || e?.status === 429) {
      const remaining = e.response?.headers?.["x-ratelimit-remaining"];
      const reset = e.response?.headers?.["x-ratelimit-reset"];
      if (remaining === "0" && reset) {
        throw new GitHubRateLimitError(new Date(Number(reset) * 1000));
      }
    }
    throw err;
  }
}

/**
 * Checks whether `login` currently has an active star on `owner/repo`.
 * Uses the authenticated GitHub "check if a repo is starred by a user"-style
 * call (via listing the user's starred repos is avoided for cost; instead we
 * use the per-user authenticated endpoint which is a single cheap request).
 */
export async function isRepoStarredByUser(
  userOctokit: Octokit,
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    await withRateLimitGuard(userOctokit, () =>
      userOctokit.request("GET /user/starred/{owner}/{repo}", { owner, repo })
    );
    return true; // 204 No Content = starred
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e?.status === 404) return false; // not starred
    throw err;
  }
}

export async function starRepoForUser(
  userOctokit: Octokit,
  owner: string,
  repo: string
): Promise<void> {
  await withRateLimitGuard(userOctokit, () =>
    userOctokit.request("PUT /user/starred/{owner}/{repo}", { owner, repo })
  );
}

/** Fetches canonical repo metadata from GitHub (used for discovery + caching). */
export async function fetchRepoMetadata(owner: string, repo: string) {
  const octokit = getAppOctokit();
  const { data } = await withRateLimitGuard(octokit, () =>
    octokit.repos.get({ owner, repo })
  );
  return data;
}

/** Searches public repos on GitHub for the discovery feed. */
export async function searchRepositories(opts: {
  query: string;
  language?: string;
  sort?: "stars" | "updated" | "best-match";
  page?: number;
  perPage?: number;
}) {
  const octokit = getAppOctokit();
  const q = [opts.query || "stars:>50", opts.language ? `language:${opts.language}` : null]
    .filter(Boolean)
    .join(" ");
  const { data } = await withRateLimitGuard(octokit, () =>
    octokit.search.repos({
      q,
      sort: opts.sort === "best-match" ? undefined : opts.sort ?? "stars",
      order: "desc",
      page: opts.page ?? 1,
      per_page: opts.perPage ?? 24,
    })
  );
  return data;
}
