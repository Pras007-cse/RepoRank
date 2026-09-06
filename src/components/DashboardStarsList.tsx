"use client";

import { useState } from "react";

type StarItem = {
  id: string;
  repositoryId: string;
  status: "PENDING" | "VERIFIED" | "REMOVED";
  verifiedAt: string | null;
  repository: {
    fullName: string;
    url: string;
    stargazersCount: number;
    language: string | null;
  };
};

const STATUS_STYLES: Record<StarItem["status"], string> = {
  VERIFIED: "text-success border-success/40",
  PENDING: "text-warn border-warn/40",
  REMOVED: "text-danger border-danger/40",
};

export default function DashboardStarsList({ stars }: { stars: StarItem[] }) {
  const [items, setItems] = useState(stars);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  async function refresh(repositoryId: string) {
    setRefreshingId(repositoryId);
    try {
      const res = await fetch(`/api/stars/${repositoryId}`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.star) {
        setItems((prev) =>
          prev.map((it) =>
            it.repositoryId === repositoryId
              ? { ...it, status: data.star.status, verifiedAt: data.star.verifiedAt }
              : it
          )
        );
      }
    } finally {
      setRefreshingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="card p-6 text-sm text-base-400">
        You haven&apos;t starred any repositories yet.{" "}
        <a href="/discover" className="text-accent-light hover:underline">
          Discover projects to support →
        </a>
      </div>
    );
  }

  return (
    <div className="card divide-y divide-base-800">
      {items.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <a
              href={s.repository.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-sm font-medium text-base-100 hover:text-accent-light"
            >
              {s.repository.fullName}
            </a>
            <p className="mt-0.5 text-xs text-base-400">
              {s.repository.language ?? "—"} · ★ {s.repository.stargazersCount.toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge ${STATUS_STYLES[s.status]}`}>{s.status}</span>
            <button
              onClick={() => refresh(s.repositoryId)}
              disabled={refreshingId === s.repositoryId}
              className="btn-secondary !px-2 !py-1 text-xs"
              title="Re-check status against GitHub"
            >
              {refreshingId === s.repositoryId ? "…" : "↻"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
