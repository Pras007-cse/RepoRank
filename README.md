# RepoRank

A GitHub developer discovery and contribution leaderboard. Sign in with GitHub, discover
repositories, support projects with real GitHub stars, and climb a leaderboard ranked by
**currently active, verified** stars — GitHub is always the source of truth.

## Stack

- **Next.js 14** (App Router, TypeScript) — single full-stack app
- **NextAuth.js** with the GitHub provider — OAuth, database-backed sessions
- **Prisma + PostgreSQL** — data layer
- **Octokit** — server-side GitHub API access
- **Tailwind CSS** — dark, developer-focused UI

## How star verification works

1. **Starring**: `POST /api/stars` stars the repo on the user's real GitHub account (using
   their OAuth token, decrypted server-side only), then immediately re-checks with GitHub
   that the star is active before crediting any score. Duplicate requests are a no-op — a
   `(userId, repositoryId)` unique constraint prevents double counting.
2. **Webhooks (fast path)**: `POST /api/webhooks/github` receives GitHub's `star` webhook
   event (`created` / `deleted`) for repos that have the webhook configured, and updates
   score in real time. Signatures are verified with HMAC-SHA256; deliveries are deduplicated
   by `X-GitHub-Delivery`.
3. **Periodic revalidation (fallback path)**: `GET /api/cron/revalidate` (protected by a
   bearer secret) re-checks the stalest-checked stars against the GitHub API in small
   batches, so scores never drift far even without a webhook. A GitHub Actions workflow
   (`.github/workflows/revalidate-stars.yml`) calls this every 15 minutes; you can swap in
   Vercel Cron or any other scheduler instead — see `scripts/revalidate-stars.ts` for a
   direct (non-HTTP) entrypoint too.
4. **Unstarring**: whichever path notices first (webhook or periodic check) flips the
   `Star.status` to `REMOVED` and recomputes the user's score — the contribution is removed
   immediately, it never lingers.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Provision a database

Any PostgreSQL instance works (e.g. Supabase, Neon, Railway, or local Postgres). Copy the
connection string into `DATABASE_URL`.

### 3. Create a GitHub OAuth App

Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**:

- Homepage URL: `http://localhost:3000` (or your deployed URL)
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

Copy the Client ID and Client Secret into `.env`.

### 4. Configure environment variables

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and generate secrets:

```bash
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
openssl rand -hex 20      # GITHUB_WEBHOOK_SECRET / CRON_SECRET
```

### 5. Push the schema and run

```bash
npm run db:push
npm run dev
```

Visit `http://localhost:3000`.

### 6. (Optional) Configure a webhook for real-time updates

On any repository you want instant unstar detection for: **Settings → Webhooks → Add
webhook**, Payload URL `https://<your-domain>/api/webhooks/github`, content type
`application/json`, secret = your `GITHUB_WEBHOOK_SECRET`, events = **Stars** only.

Without a webhook, the periodic revalidation job still keeps things accurate — just with
up to ~15 minutes of lag instead of instant updates.

## Project structure

```
src/
  app/
    api/            # route handlers (auth, repos, stars, leaderboard, webhooks, cron)
    dashboard/       user dashboard (score, rank, stars, activity)
    discover/        repository discovery feed
    leaderboard/      global / trending / category leaderboards
    profile/[login]/  public developer profile
  components/       # RepoCard, LeaderboardTable, Navbar, StatCard, ...
  lib/
    auth.ts          NextAuth config
    github.ts         Octokit wrapper + rate-limit guard
    scoring.ts         star verification + score/rank recomputation
    crypto.ts           AES-256-GCM encryption for stored tokens
    rateLimit.ts          in-memory rate limiter for our own API routes
    category.ts             repo → category inference
prisma/schema.prisma  # data model
scripts/revalidate-stars.ts  # standalone cron entrypoint
.github/workflows/revalidate-stars.yml  # scheduled fallback revalidation
```

## Security notes

- GitHub OAuth access tokens are encrypted at rest (AES-256-GCM) and only ever decrypted
  server-side to call the GitHub API on the user's behalf — never sent to the client.
- Sessions are database-backed, so access can be revoked by deleting `Session` rows.
- Webhook payloads are verified via HMAC-SHA256 signature before being trusted, and are
  strictly schema-validated (zod) after that so a malformed or unexpected body returns a
  clean 400 instead of an unhandled 500.
- Bearer-secret protected endpoints (`/api/cron/revalidate`) use a constant-time
  comparison and fail closed if the secret env var is unset — an unset secret can never
  match an attacker-supplied header.
- All state-changing API routes (`POST /api/stars`, `POST /api/stars/:id`) check the
  request's `Origin` against the app's canonical URL as a second, independent layer of
  CSRF protection on top of NextAuth's `SameSite=Lax` session cookie.
- API routes are protected by a lightweight sliding-window rate limiter, separate from
  GitHub's own rate limits (which are also respected, with graceful fallback to cached
  data when exhausted). It's in-memory and per-instance — fine for a single-instance
  deployment, but swap in a shared store (`@upstash/ratelimit` or similar) behind the same
  `rateLimit()` interface before scaling to multiple instances/regions. It keys on
  `X-Forwarded-For`, which is only trustworthy behind a proxy/CDN that sets it itself
  (Vercel, Cloudflare, nginx) — don't expose the app directly to the internet without one.
- All query-string inputs (pagination, limits, category filters) are bounds-checked so a
  malformed value (`NaN`, negative, oversized) can't reach the database layer.
- Global security headers (CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`,
  `Permissions-Policy`, no `X-Powered-By`) are set for every route in `next.config.mjs`.
- Dependabot and CodeQL run on a schedule and on every push/PR (`.github/workflows/`); CI
  also runs `npm audit --audit-level=high` on every PR, and the dependency tree is
  currently clean (0 known vulnerabilities). See `SECURITY.md` for how to report one.
- Runs on Next.js 15.5.x, which includes the fixes for the batch of RSC/Server Actions
  DoS and cache-poisoning CVEs disclosed against the 14.x/15.x line — don't downgrade.
- Runs on `next-auth@5.0.0-beta.32` (Auth.js), not v4. Every v4 release from 4.24.8
  through 4.24.15 carries a critical vulnerability
  ([GHSA-7rqj-j65f-68wh](https://github.com/advisories/GHSA-7rqj-j65f-68wh) and related),
  and 4.24.7 — the last unaffected v4 release — doesn't support Next.js 15 as a peer. v5 is
  patched and the only version officially compatible with Next 15+; despite the "beta" tag
  it's the actively maintained release line and what Auth.js recommends for App Router
  apps today.
