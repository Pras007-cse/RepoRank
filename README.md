<div align="center">

# RepoRank

<p align="center">
  <strong>An automated GitHub developer discovery, star verification, and contribution leaderboard platform.</strong>
</p>

<p align="center">
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js" alt="Next.js" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.0%2B-blue?style=for-the-badge&logo=typescript" alt="TypeScript" /></a>
  <a href="https://www.prisma.io"><img src="https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma" alt="Prisma" /></a>
  <a href="https://next-auth.js.org"><img src="https://img.shields.io/badge/NextAuth.js-OAuth-purple?style=for-the-badge&logo=auth0" alt="NextAuth" /></a>
  <a href="https://tailwindcss.com"><img src="https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC?style=for-the-badge&logo=tailwind-css" alt="Tailwind CSS" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="License" /></a>
</p>

[Overview](#overview) • [Key Features](#key-features) • [Star Verification Engine](#how-star-verification-works) • [Tech Stack](#tech-stack) • [Getting Started](#getting-started) • [Architecture](#project-structure) • [Security](#security-architecture)

</div>

---

## Overview

**RepoRank** is a modern full-stack application built to track, verify, and rank open-source contributions through verified GitHub stars. Developers sign in with GitHub, discover open-source projects, and support them with real stars. Rankings and contribution leaderboards are driven strictly by **currently active, verified stars** — ensuring GitHub remains the immutable source of truth and eliminating fraudulent scoring.

---

## Key Features

- **GitHub OAuth Authentication**: Seamless, database-backed user sessions powered by NextAuth.js.
- **Bi-directional Star Verification**:
  - **Fast-path Webhooks**: Instant HMAC-verified star and unstar detection via GitHub webhooks.
  - **Scheduled Revalidation Engine**: Batch cron jobs and GitHub Actions to detect star status changes even without webhooks.
- **Dynamic Leaderboards**: Real-time ranking across global, trending, and category-specific leaderboards.
- **Discovery Feed & Automated Categorization**: Semantic repository classification and activity metrics.
- **Enterprise-Grade Token Security**: Sensitive OAuth access tokens are encrypted at rest using AES-256-GCM.
- **API Rate Limiting & Protection**: Dual-layer protection with internal sliding-window limits alongside proactive Octokit GitHub API rate limit tracking.

---

## How Star Verification Works

RepoRank enforces a multi-tier verification pipeline to guarantee score integrity:

```
                  ┌──────────────────────┐
                  │   User Stars Repo    │
                  │   (POST /api/stars)  │
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   [ Fast Path: Webhook ]            [ Fallback: Revalidation ]
GitHub sends star event           Scheduled cron job runs
(created / deleted) via HMAC      (/api/cron/revalidate or script)
            │                                 │
            └────────────────┬────────────────┘
                             ▼
               ┌───────────────────────────┐
               │    Update Star Record     │
               │    (ACTIVE / REMOVED)     │
               └─────────────┬─────────────┘
                             ▼
               ┌───────────────────────────┐
               │  Recompute User Score &   │
               │  Update Leaderboard Rank  │
               └───────────────────────────┘
```

1. **Starring (`POST /api/stars`)**: Initiates a star on the user's authentic GitHub account using their decrypted OAuth token. It verifies the star's active status with GitHub before crediting any score. Duplicate requests are prevented by a database-level `(userId, repositoryId)` unique constraint.
2. **Webhooks (`POST /api/webhooks/github`)**: Listens for GitHub `star` events (`created` / `deleted`). Payloads are authenticated using HMAC-SHA256 signatures, and deliveries are deduplicated via `X-GitHub-Delivery`.
3. **Periodic Revalidation (`GET /api/cron/revalidate`)**: A bearer-token-protected endpoint checks stalest stars in batches. An automated GitHub Action (`.github/workflows/revalidate-stars.yml`) triggers this every 15 minutes to guarantee eventual consistency.
4. **Instant Score Revocation**: Whenever an unstar is detected by either webhooks or scheduled polling, `Star.status` transitions to `REMOVED` and the user's score is immediately decremented.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend Framework** | [Next.js 14](https://nextjs.org/) (App Router, Server Components) |
| **Language** | [TypeScript](https://www.typescriptlang.org/) (Strict Mode) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) (Developer-focused Dark Theme) |
| **Database & ORM** | [PostgreSQL](https://www.postgresql.org/) with [Prisma ORM](https://www.prisma.io/) |
| **Authentication** | [NextAuth.js](https://next-auth.js.org/) with GitHub OAuth Provider |
| **GitHub API Client** | [@octokit/rest](https://github.com/octokit/rest.js) |
| **Security & Cryptography** | AES-256-GCM Token Encryption, HMAC-SHA256 Webhook Verification |

---

## Getting Started

### Prerequisites

- **Node.js**: v18.17+ or v20+
- **PostgreSQL Database**: Local or managed instance (Supabase, Neon, Railway, etc.)
- **GitHub OAuth App**: Registered via [GitHub Developer Settings](https://github.com/settings/developers)
  - **Homepage URL**: `http://localhost:3000`
  - **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`

---

### Step-by-Step Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/Pras007-cse/RepoRank.git
   cd RepoRank
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   ```bash
   cp .env.example .env
   ```

   Generate cryptographic secrets:
   ```bash
   # NEXTAUTH_SECRET (Base64)
   openssl rand -base64 32

   # TOKEN_ENCRYPTION_KEY (Base64 - 32 bytes)
   openssl rand -base64 32

   # GITHUB_WEBHOOK_SECRET / CRON_SECRET (Hex)
   openssl rand -hex 20
   ```

   Populate your `.env` configuration:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/reporank?schema=public"
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="your-generated-nextauth-secret"

   GITHUB_CLIENT_ID="your-github-oauth-client-id"
   GITHUB_CLIENT_SECRET="your-github-oauth-client-secret"

   TOKEN_ENCRYPTION_KEY="your-generated-32-byte-key"
   GITHUB_WEBHOOK_SECRET="your-generated-webhook-secret"
   CRON_SECRET="your-generated-cron-secret"
   ```

4. **Sync Database Schema**
   ```bash
   npm run db:push
   ```

5. **Start the Application**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Webhook Setup (Optional for Instant Sync)

To receive real-time star updates on any repository:
1. Navigate to repository **Settings → Webhooks → Add webhook**.
2. **Payload URL**: `https://<your-domain>/api/webhooks/github`
3. **Content type**: `application/json`
4. **Secret**: Value of `GITHUB_WEBHOOK_SECRET`
5. **Events**: Select **Stars** only.

*(Without webhooks, the fallback revalidation workflow ensures eventual consistency within 15 minutes).*

---

## Project Structure

```text
RepoRank/
├── .github/
│   └── workflows/
│       └── revalidate-stars.yml # Scheduled 15-minute fallback revalidation
├── prisma/
│   └── schema.prisma            # Relational database models
├── scripts/
│   └── revalidate-stars.ts      # Standalone star verification CLI script
├── src/
│   ├── app/
│   │   ├── api/                 # API route handlers (auth, repos, stars, webhooks, cron)
│   │   ├── dashboard/           # User dashboard (scores, rank, activity)
│   │   ├── discover/            # Curated repository discovery feed
│   │   ├── leaderboard/         # Global & category leaderboards
│   │   └── profile/[login]/     # Public developer profile view
│   ├── components/              # UI components (RepoCard, LeaderboardTable, Navbar, etc.)
│   └── lib/
│       ├── auth.ts              # NextAuth configuration
│       ├── category.ts          # Repository category inference logic
│       ├── crypto.ts            # AES-256-GCM encryption utilities
│       ├── github.ts            # Octokit client & rate-limit wrappers
│       ├── prisma.ts            # Prisma client singleton
│       ├── rateLimit.ts         # Sliding-window in-memory rate limiter
│       └── scoring.ts           # Star status verification & scoring algorithms
├── .env.example                 # Template for environment configuration
├── package.json                 # Dependencies and build scripts
└── tsconfig.json                # TypeScript compiler configuration
```

---

## Security Architecture

- **Token Encryption at Rest**: GitHub OAuth tokens are encrypted using **AES-256-GCM** before being persisted in PostgreSQL. Decryption occurs exclusively server-side during API requests and tokens are never exposed to client browsers.
- **Revocable Database Sessions**: Session tokens are backed by database records, allowing instant session invalidation and account management.
- **HMAC Payload Verification**: Inbound webhook requests are validated against GitHub's cryptographic HMAC-SHA256 signature to prevent spoofing.
- **Rate-Limiting Protection**: Sliding-window rate limiters shield internal API endpoints against abuse while respecting upstream GitHub REST API quotas.
- **Protected Cron Endpoints**: Operational endpoints like `/api/cron/revalidate` require high-entropy bearer secrets for authorization.

---

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/Pras007-cse/RepoRank/issues).

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m "feat: Add some AmazingFeature"`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## License

Distributed under the MIT License. See `LICENSE` for more information.
