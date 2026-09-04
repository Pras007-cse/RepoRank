"use client";

import { useEffect, useState } from "react";
import LeaderboardTable, { type LeaderboardUser } from "@/components/LeaderboardTable";

const TABS = [
  { key: "global", label: "Global" },
  { key: "trending", label: "Trending (7d)" },
  { key: "category", label: "By Category" },
] as const;

const CATEGORIES = ["WEB", "MOBILE", "AI_ML", "DEVOPS", "DATABASE", "SECURITY", "GAME_DEV", "CLI_TOOLING", "LIBRARY", "OTHER"];

export default function LeaderboardPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("global");
  const [category, setCategory] = useState("WEB");
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ scope: tab });
    if (tab === "category") params.set("category", category);
    fetch(`/api/leaderboard?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setUsers(data.users ?? []))
      .finally(() => setLoading(false));
  }, [tab, category]);

  const scoreKey = tab === "trending" ? "recentStars" : tab === "category" ? "categoryScore" : "contributionScore";
  const scoreLabel = tab === "trending" ? "Stars (7d)" : "Contribution Score";

  return (
    <div>
      <h1 className="text-2xl font-semibold text-base-100">Leaderboard</h1>
      <p className="mt-1 text-sm text-base-400">
        Ranked by currently active, verified GitHub stars — GitHub is the source of truth.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={tab === t.key ? "btn-primary !py-1.5 text-xs" : "btn-secondary !py-1.5 text-xs"}
          >
            {t.label}
          </button>
        ))}
        {tab === "category" && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="ml-2 rounded-lg border border-base-700 bg-base-850 px-3 py-1.5 text-xs text-base-100 focus:border-accent focus:outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="card h-64 animate-pulse" />
        ) : (
          <LeaderboardTable users={users} scoreKey={scoreKey} scoreLabel={scoreLabel} />
        )}
      </div>
    </div>
  );
}
