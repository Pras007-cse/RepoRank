"use client";

import { useState } from "react";
import { useSession, signIn } from "next-auth/react";

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

export default function RepoCard({ repo }: { repo: RepoCardData }) {
  const { data: session } = useSession();
  const [status, setStatus] = useState<"idle" | "loading" | "verified" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleStar() {
    if (!session) {
      signIn("github");
      return;
    }
    setStatus("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/stars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId: repo.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "Failed to star repository.");
        setStatus("error");
        return;
      }
      setStatus("verified");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

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
          <span className="badge shrink-0">{CATEGORY_LABELS[repo.category] ?? repo.category}</span>
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

        <button
          onClick={handleStar}
          disabled={status === "loading" || status === "verified"}
          className={status === "verified" ? "btn-secondary !border-success/50 !text-success" : "btn-primary"}
        >
          {status === "verified" ? "✓ Verified" : status === "loading" ? "Starring…" : "Star on GitHub"}
        </button>
      </div>
      {errorMsg && <p className="mt-2 text-xs text-danger">{errorMsg}</p>}
    </div>
  );
}
