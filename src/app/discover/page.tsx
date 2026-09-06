"use client";

import { useEffect, useState, useCallback } from "react";
import RepoCard, { type RepoCardData } from "@/components/RepoCard";

const LANGUAGES = ["", "TypeScript", "Python", "Go", "Rust", "JavaScript", "Java", "C++"];
const CATEGORIES = [
  "",
  "WEB",
  "MOBILE",
  "AI_ML",
  "DEVOPS",
  "DATABASE",
  "SECURITY",
  "GAME_DEV",
  "CLI_TOOLING",
  "LIBRARY",
  "OTHER",
];

export default function DiscoverPage() {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [category, setCategory] = useState("");
  const [repos, setRepos] = useState<RepoCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (language) params.set("language", language);
    if (category) params.set("category", category);
    try {
      const res = await fetch(`/api/repos?${params.toString()}`);
      const data = await res.json();
      setRepos(data.items ?? []);
      if (data.notice) setNotice(data.notice);
    } finally {
      setLoading(false);
    }
  }, [query, language, category]);

  useEffect(() => {
    fetchRepos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-base-100">Discover repositories</h1>
      <p className="mt-1 text-sm text-base-400">
        Search open-source projects and support them with a verified GitHub star.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          fetchRepos();
        }}
        className="mt-6 flex flex-col gap-3 sm:flex-row"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search repositories…"
          className="flex-1 rounded-lg border border-base-700 bg-base-850 px-4 py-2 text-sm text-base-100 placeholder:text-base-400 focus:border-accent focus:outline-none"
        />
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="rounded-lg border border-base-700 bg-base-850 px-3 py-2 text-sm text-base-100 focus:border-accent focus:outline-none"
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l || "All languages"}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-base-700 bg-base-850 px-3 py-2 text-sm text-base-100 focus:border-accent focus:outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c || "All categories"}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary">
          Search
        </button>
      </form>

      {notice && <p className="mt-4 text-xs text-warn">{notice}</p>}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card h-40 animate-pulse p-5" />
            ))
          : repos.map((repo) => <RepoCard key={repo.id} repo={repo} />)}
      </div>

      {!loading && repos.length === 0 && (
        <p className="mt-10 text-center text-sm text-base-400">
          No repositories found. Try a different search or filter.
        </p>
      )}
    </div>
  );
}
