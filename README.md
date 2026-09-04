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
- Webhook payloads are verified via HMAC-SHA256 signature before being trusted.
- API routes are protected by a lightweight sliding-window rate limiter, separate from
  GitHub's own rate limits (which are also respected, with graceful fallback to cached
  data when exhausted).
- The `/api/cron/revalidate` endpoint requires a bearer secret and is not user-facing.
