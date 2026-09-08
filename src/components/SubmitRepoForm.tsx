"use client";

import { useState } from "react";
import Link from "next/link";

type SubmitResult = {
  project: { id: string; fullName: string; url: string; stargazersCount: number; ownerUserId: string | null };
  claimed: boolean;
  claimInstructions?: string;
};

export default function SubmitRepoForm() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't register that repository.");
        setStatus("error");
        return;
      }
      setResult(data);
      setStatus("done");
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (result) {
    return (
      <div className="card p-6 text-left">
        <div className="flex items-center justify-between gap-2">
          <a
            href={result.project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-base font-semibold text-base-100 hover:text-accent-light"
          >
            {result.project.fullName}
          </a>
          <span className="mono-num text-sm text-base-400">
            ★ {result.project.stargazersCount.toLocaleString()}
          </span>
        </div>
        {result.claimed ? (
          <p className="mt-2 text-sm text-success">You&apos;re verified as this project&apos;s owner.</p>
        ) : (
          <p className="mt-2 text-sm text-base-400">{result.claimInstructions}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/discover" className="btn-secondary">
            Explore more projects
          </Link>
          {!result.claimed && (
            <Link href="/claim" className="btn-primary">
              Claim this project
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <input
        type="url"
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repo"
        className="flex-1 rounded-md border border-base-700 bg-base-900 px-4 py-2.5 text-sm text-base-100 placeholder:text-base-500 focus:border-accent focus:outline-none"
      />
      <button type="submit" disabled={status === "loading"} className="btn-primary shrink-0">
        {status === "loading" ? "Fetching…" : "Continue →"}
      </button>
      {error && <p className="text-xs text-danger sm:basis-full">{error}</p>}
    </form>
  );
}
