"use client";

import { useState } from "react";
import Link from "next/link";
import { GitHubIcon } from "@/components/Navbar";

type Step = "enter-username" | "awaiting-bio-edit" | "verified" | "error";

export default function ClaimPage() {
  const [githubUsername, setGithubUsername] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("enter-username");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function startChallenge(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch("/api/builder/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUsername }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't start verification.");
        return;
      }
      setCode(data.code);
      setInstructions(data.instructions);
      setStep("awaiting-bio-edit");
    } catch {
      setError("Network error. Please try again.");
    }
  }

  async function confirmChallenge() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch("/api/builder/verify/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUsername }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified) {
        setError(data.error ?? "Verification failed.");
        return;
      }
      setStep("verified");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg pt-16">
      <h1 className="text-2xl font-bold text-base-100">Verify your builder identity</h1>
      <p className="mt-2 text-sm text-base-400">
        Needed only to claim a project, send or accept connections, or edit a project profile —
        never to browse or submit repos.
      </p>

      <div className="card mt-8 p-6">
        {step === "enter-username" && (
          <form onSubmit={startChallenge} className="flex flex-col gap-3">
            <label className="text-sm text-base-300" htmlFor="gh-username">
              Your GitHub username
            </label>
            <input
              id="gh-username"
              required
              value={githubUsername}
              onChange={(e) => setGithubUsername(e.target.value)}
              placeholder="octocat"
              className="rounded-md border border-base-700 bg-base-900 px-4 py-2.5 text-sm text-base-100 placeholder:text-base-500 focus:border-accent focus:outline-none"
            />
            <button type="submit" className="btn-primary">
              Get a verification code
            </button>
          </form>
        )}

        {step === "awaiting-bio-edit" && code && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-base-300">
              Add this code anywhere in your GitHub profile bio, save, then confirm below:
            </p>
            <code className="rounded-md bg-base-900 px-4 py-3 text-center text-lg font-bold tracking-widest text-accent-light">
              {code}
            </code>
            <a
              href="https://github.com/settings/profile"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent-light hover:underline"
            >
              Open GitHub profile settings ↗
            </a>
            <button onClick={confirmChallenge} disabled={confirming} className="btn-primary">
              {confirming ? "Checking…" : "I've added it — confirm"}
            </button>
            <p className="text-xs text-base-500">
              Expires in 15 minutes. Safe to remove from your bio right after confirming.
            </p>
          </div>
        )}

        {step === "verified" && (
          <div className="flex flex-col gap-3 text-center">
            <p className="text-success">You&apos;re verified. Any registered projects you own were claimed automatically.</p>
            <Link href="/dashboard" className="btn-primary">
              Go to your dashboard
            </Link>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      </div>

      <div className="mt-6 text-center">
        <Link href="/api/auth/signin?provider=github" className="text-sm text-base-400 hover:text-base-100">
          <span className="inline-flex items-center gap-1.5">
            <GitHubIcon className="h-4 w-4" />
            Or verify instantly with GitHub instead
          </span>
        </Link>
      </div>
    </div>
  );
}
