"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";

const links = [
  { href: "/discover", label: "Discover" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-base-800 bg-base-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-white">
              R
            </span>
            <span className="text-base font-semibold tracking-tight text-base-100">
              Repo<span className="text-accent-light">Rank</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 sm:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm font-medium transition-colors ${
                  pathname?.startsWith(l.href)
                    ? "text-accent-light"
                    : "text-base-300 hover:text-base-100"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div>
          {status === "loading" ? (
            <div className="h-8 w-24 animate-pulse rounded-lg bg-base-800" />
          ) : session?.user ? (
            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-base-800">
                {session.user.image && (
                  <Image
                    src={session.user.image}
                    alt={session.user.name ?? "avatar"}
                    width={28}
                    height={28}
                    className="rounded-full ring-1 ring-base-600"
                  />
                )}
                <span className="hidden text-sm text-base-200 sm:inline">{session.user.name}</span>
              </Link>
              <button onClick={() => signOut()} className="btn-secondary !px-3 !py-1.5 text-xs">
                Sign out
              </button>
            </div>
          ) : (
            <button onClick={() => signIn("github")} className="btn-primary !px-3 !py-1.5 text-xs">
              <GitHubIcon className="h-4 w-4" />
              Sign in with GitHub
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.57.1.78-.25.78-.55v-2.16c-3.2.7-3.87-1.36-3.87-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.07.78 2.15v3.19c0 .31.21.66.79.55A10.51 10.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}
