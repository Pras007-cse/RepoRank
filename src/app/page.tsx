import Link from "next/link";
import { GitHubIcon } from "@/components/Navbar";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center pt-16 text-center sm:pt-24">
      <span className="badge mb-6">GitHub-verified contribution ranking</span>
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-base-100 sm:text-6xl">
        Discover repos. <span className="text-accent-light">Star them for real.</span>
        <br />
        Climb the leaderboard.
      </h1>
      <p className="mt-6 max-w-xl text-base text-base-300">
        RepoRank connects to your GitHub account, tracks the open-source projects you actually
        star, and ranks developers by currently active, verified contributions — no gaming the
        system, GitHub is always the source of truth.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
        <Link href="/api/auth/signin?provider=github" className="btn-primary">
          <GitHubIcon className="h-4 w-4" />
          Sign in with GitHub
        </Link>
        <Link href="/discover" className="btn-secondary">
          Browse repositories
        </Link>
      </div>

      <div className="mt-20 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
        <FeatureCard
          title="Verified, not vibes"
          body="Every star is checked against the real GitHub API. Unstar it, and it's out of your score — instantly."
        />
        <FeatureCard
          title="Category leaderboards"
          body="Rankings by language and category — AI/ML, Web, DevOps, Security, and more."
        />
        <FeatureCard
          title="Always in sync"
          body="Webhooks catch changes in real time; periodic checks keep everything correct as a fallback."
        />
      </div>
    </div>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card p-6 text-left">
      <h3 className="text-sm font-semibold text-base-100">{title}</h3>
      <p className="mt-2 text-sm text-base-400">{body}</p>
    </div>
  );
}
