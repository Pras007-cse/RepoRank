/**
 * All outbound GitHub calls go through here, and only ever hit
 * api.github.com — we never fetch a user-supplied URL directly. A pasted
 * repo URL is parsed for owner/repo with a strict regex and then discarded;
 * every actual network call is built from scratch against a fixed host.
 * This closes off SSRF via a crafted "github URL" (e.g. pointing at an
 * internal service, or a redirect chain) — the pasted string can only ever
 * become two path segments in a request to a host we chose.
 */

const GITHUB_REPO_URL_RE =
  /^https:\/\/github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)\/([a-zA-Z0-9._-]{1,100})\/?$/;

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export function parseRepoUrl(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\.git$/, "");
  const match = GITHUB_REPO_URL_RE.exec(trimmed);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function authHeaders(token: string | undefined): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ProjectStar-Worker",
  };
  // Optional server-held PAT to raise the outbound rate limit from 60/hr to
  // 5,000/hr. This is our backend calling GitHub as itself, not a user
  // OAuth grant — no user ever authenticates or authorizes anything.
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function githubFetch(url: string, token: string | undefined, accept?: string) {
  const headers = authHeaders(token);
  if (accept) (headers as Record<string, string>)["Accept"] = accept;
  const res = await fetch(url, { headers });
  if (res.status === 404) throw new GitHubApiError("Not found", 404);
  if (res.status === 403 || res.status === 429) {
    throw new GitHubApiError("GitHub API rate limit reached", 429);
  }
  if (!res.ok) throw new GitHubApiError(`GitHub API error (${res.status})`, res.status);
  return res;
}

export interface RepoMetadata {
  githubRepoId: number;
  ownerLogin: string;
  ownerId: number;
  repoName: string;
  fullName: string;
  description: string | null;
  primaryLanguage: string | null;
  topics: string[];
  stargazersCount: number;
  htmlUrl: string;
}

export async function fetchRepoMetadata(
  owner: string,
  repo: string,
  token: string | undefined
): Promise<RepoMetadata> {
  const res = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`, token);
  const data = (await res.json()) as {
    id: number;
    owner: { login: string; id: number };
    name: string;
    full_name: string;
    description: string | null;
    language: string | null;
    topics?: string[];
    stargazers_count: number;
    html_url: string;
    private: boolean;
    fork: boolean;
  };

  if (data.private) {
    throw new GitHubApiError("Private repositories cannot be registered.", 422);
  }

  return {
    githubRepoId: data.id,
    ownerLogin: data.owner.login,
    ownerId: data.owner.id,
    repoName: data.name,
    fullName: data.full_name,
    description: data.description,
    primaryLanguage: data.language,
    topics: data.topics ?? [],
    stargazersCount: data.stargazers_count,
    htmlUrl: data.html_url,
  };
}

export async function fetchReadmeText(
  owner: string,
  repo: string,
  token: string | undefined
): Promise<string> {
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/readme`,
    token,
    "application/vnd.github.raw"
  );
  return res.text();
}

/** Paginates GET /users/{username}/starred, returning the set of starred repo ids. */
export async function fetchStarredRepoIds(
  username: string,
  token: string | undefined
): Promise<Set<number>> {
  const ids = new Set<number>();
  let page = 1;
  const perPage = 100;
  // Hard cap of pages so one extremely-followed account can't blow the
  // Worker's CPU/time budget on a single sync tick — anti-abuse in the
  // resource sense, not the ranking sense.
  const MAX_PAGES = 20;

  while (page <= MAX_PAGES) {
    const res = await githubFetch(
      `https://api.github.com/users/${username}/starred?per_page=${perPage}&page=${page}`,
      token
    );
    const batch = (await res.json()) as Array<{ id: number }>;
    for (const repo of batch) ids.add(repo.id);
    if (batch.length < perPage) break;
    page += 1;
  }
  return ids;
}

export async function fetchGithubUser(
  username: string,
  token: string | undefined
): Promise<{ id: number; login: string; name: string | null; avatarUrl: string }> {
  const res = await githubFetch(`https://api.github.com/users/${username}`, token);
  const data = (await res.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
  };
  return { id: data.id, login: data.login, name: data.name, avatarUrl: data.avatar_url };
}
