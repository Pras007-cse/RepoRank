export type RepoCardData = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  description?: string | null;
  url: string;
  language?: string | null;
  category: string;
  stargazersCount: number;
  ownerUserId?: string | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  WEB: "Web",
  MOBILE: "Mobile",
  AI_ML: "AI / ML",
  DEVOPS: "DevOps",
  DATABASE: "Database",
  SECURITY: "Security",
  GAME_DEV: "Game Dev",
  CLI_TOOLING: "CLI / Tooling",
  LIBRARY: "Library",
  OTHER: "Other",
};

/**
 * No in-app "star for me" action anymore — starring happens on real GitHub,
 * and this app only ever detects it afterward (see lib/scoring.ts). The
 * button here just opens the real repo page; the star count shown is
 * GitHub's own public stargazers_count, distinct from ProjectStar's
 * verified-stars-received metric shown elsewhere (leaderboard/project page).
 */
export default function RepoCard({ repo }: { repo: RepoCardData }) {
  return (
    <div className="card card-hover flex flex-col justify-between p-5">
      <div>
        <div className="flex items-start justify-between gap-2">
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-base-100 hover:text-accent-light"
          >
            {repo.owner}/<span className="text-accent-light">{repo.name}</span>
          </a>
          <div className="flex shrink-0 items-center gap-1.5">
            {!repo.ownerUserId && (
              <span className="badge !border-warn/40 !text-warn" title="No verified owner yet">
                Unclaimed
              </span>
            )}
            <span className="badge">{CATEGORY_LABELS[repo.category] ?? repo.category}</span>
          </div>
        </div>
        <p className="mt-2 line-clamp-3 text-sm text-base-300">
          {repo.description || "No description provided."}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-base-400">
          {repo.language && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent" />
              {repo.language}
            </span>
          )}
          <span className="mono-num">★ {repo.stargazersCount.toLocaleString()}</span>
        </div>

        <a href={repo.url} target="_blank" rel="noopener noreferrer" className="btn-primary">
          Star on GitHub ↗
        </a>
      </div>
    </div>
  );
}
