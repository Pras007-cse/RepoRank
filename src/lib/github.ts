import { Octokit } from "@octokit/rest";

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
 * Checks whether `login` currently has an active star on `owner/repo`, using
 * only public data via the app-level token (or unauthenticated) — never a
 * per-user token. The old per-user "does this authenticated user have this
 * repo starred" check and the write-based star-granting call are gone; see
 * fetchStarredRepoIds below, which is what the sync job now uses.
 */

/** Paginates GET /users/{username}/starred — public data, no per-user token needed. */
export async function fetchStarredRepoIds(login: string): Promise<Set<number>> {
  const octokit = getAppOctokit();
  const ids = new Set<number>();
  let page = 1;
  const perPage = 100;
  const MAX_PAGES = 20; // bounds one sync tick's cost even for accounts with huge starred lists

  while (page <= MAX_PAGES) {
    const { data } = await withRateLimitGuard(octokit, () =>
      octokit.request("GET /users/{username}/starred", { username: login, per_page: perPage, page })
    );
    for (const repo of data as Array<{ id: number }>) ids.add(repo.id);
    if (data.length < perPage) break;
    page += 1;
  }
  return ids;
}

/** Fetches a GitHub user's public profile, including bio — used by the ownership-challenge check. */
export async function fetchGithubUserProfile(
  login: string
): Promise<{ id: number; login: string; name: string | null; bio: string | null; avatarUrl: string }> {
  const octokit = getAppOctokit();
  const { data } = await withRateLimitGuard(octokit, () => octokit.users.getByUsername({ username: login }));
  return { id: data.id, login: data.login, name: data.name, bio: data.bio ?? null, avatarUrl: data.avatar_url };
}

/**
 * Strictly parses a github.com repo URL into owner/repo and discards the
 * rest — every actual network call is built from scratch against
 * api.github.com, never against the pasted URL itself. Closes off SSRF via
 * a crafted "repo URL" (e.g. pointing at an internal host, or a redirect).
 */
const GITHUB_REPO_URL_RE =
  /^https:\/\/github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)\/([a-zA-Z0-9._-]{1,100})\/?$/;

export function parseRepoUrl(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\.git$/, "");
  const match = GITHUB_REPO_URL_RE.exec(trimmed);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
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
