# Security Policy

## Reporting a vulnerability

If you believe you've found a security vulnerability in RepoRank, please
report it privately rather than opening a public issue:

- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
  feature on this repository (**Security → Report a vulnerability**), or
- Email the maintainer directly (see the GitHub profile for contact info).

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce it (a minimal repro is ideal)
- Any relevant logs, request/response samples, or PoC code

We'll acknowledge reports as quickly as we can and keep you updated as a fix
is developed. Please give us a reasonable window to fix the issue before any
public disclosure.

## Supported versions

Only the `main` branch is actively maintained. There are no separate
long-term-support release lines at this stage.

## Scope

In scope:

- The application code in this repository (`src/`, `prisma/`, `scripts/`)
- Authentication/session handling, the star-verification pipeline, and the
  webhook/cron endpoints
- Misconfigurations in the shipped GitHub Actions workflows

Out of scope:

- Vulnerabilities in third-party dependencies with no known exploit path
  through this app (report those upstream; we do track and patch via
  Dependabot/CodeQL, see below)
- Issues that require an attacker to already have the target's GitHub
  OAuth token or database credentials
- Denial of service via raw traffic volume against a self-hosted deployment
  with no rate limiting/WAF in front of it — see the rate-limiting notes in
  the README for expected deployment posture

## What we already do

- GitHub OAuth access tokens are encrypted at rest (AES-256-GCM) and only
  ever decrypted server-side.
- Sessions are database-backed and revocable.
- Webhook payloads are HMAC-SHA256 verified and delivery-deduplicated.
- Bearer-secret protected endpoints (cron) use constant-time comparison and
  fail closed if the secret is unset.
- Dependabot and CodeQL run on every push/PR (see `.github/workflows`), and CI runs
  `npm audit --audit-level=high` on every PR — the dependency tree currently has 0
  known high/critical vulnerabilities.
- Pinned to `next-auth@5.0.0-beta.32` rather than v4, since v4.24.8–4.24.15 all carry
  a critical vulnerability and the last unaffected v4 release doesn't support Next 15.
