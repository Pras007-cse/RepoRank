import Link from "next/link";
import { GitHubIcon } from "@/components/Navbar";
import SubmitRepoForm from "@/components/SubmitRepoForm";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center pt-16 text-center sm:pt-24">
      <span className="badge mb-6">GitHub-verified contribution ranking</span>
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-base-100 sm:text-6xl">
        Drop your GitHub project. <span className="text-accent-light">See it instantly.</span>
      </h1>
      <p className="mt-6 max-w-xl text-base text-base-300">
        Paste a repo URL below — no sign-in, no GitHub App, no permissions. Real stars from
        other verified builders count toward ranking; GitHub is always the source of truth.
      </p>

      <div className="mt-10 w-full max-w-lg">
        <SubmitRepoForm />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm">
        <Link href="/discover" className="btn-secondary">
          Browse without submitting
        </Link>
        <Link href="/api/auth/signin?provider=github" className="text-base-400 hover:text-base-100">
          <span className="inline-flex items-center gap-1.5">
            <GitHubIcon className="h-4 w-4" />
            Verify instantly with GitHub
          </span>
        </Link>
      </div>

      <div className="mt-20 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
        <FeatureCard
          title="Claim when it matters"
          body="Your project shows up unclaimed right away. Verifying ownership — a short code in your GitHub bio, or instant OAuth — is only needed to claim it, connect with others, or edit its profile."
        />
        <FeatureCard
          title="Verified, not vibes"
          body="Every star is checked against the real GitHub API, from other verified builders only. Unstar it, and it's out of the count — instantly."
        />
        <FeatureCard
          title="No benefit from someone else's project"
          body="Submitting a repo you don't own gives you nothing — no ranking, no ownership, no ability to act as its owner. Stars and ranking always belong to the real owner."
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
