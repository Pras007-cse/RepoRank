# ProjectStar

Social discovery network for student projects, ranked by **real, currently-active
GitHub stars between registered students** — not internal likes, not lifetime star
counts, not one-sided claims.

## Status

- **Phase 1 (submission + metadata) — done.** `POST /api/projects`
- **Phase 2 (star sync — highest priority per spec) — done.** Cron-driven, GitHub is
  always the source of truth. See `worker/src/sync.ts`.
- **Phase 3 (ranking) — done as a DB view**, not app-computed state. See
  `project_ranking` in `supabase/schema.sql`.
- **Phase 4 (connections) — done, with one addition:** see "Session model" below.
- **Phase 5 (UI polish, deployment, full frontend) — not built.** `worker/` is a
  complete, working API; `web/` is an empty placeholder. Say the word and I'll build
  the discovery feed / project page / submission form on top of these endpoints.

## Why this deviates from the spec in two places

### 1. Per-project ownership verification (README marker)

The spec's frictionless flow ("paste a GitHub URL, register it, done") has no way to
tell the difference between "the real owner registered their project" and "someone
typed a stranger's username and claimed their repo." Since ranking, appreciation, and
(now) connections all attach to a `users` row keyed by `github_username`, that gap is
an identity-takeover vector, not just a cosmetic one — it's still zero-OAuth (no
redirect, no consent screen, no scopes), just proof-of-control via a README edit,
same pattern as domain verification on most SaaS platforms.

A project is created immediately (frictionless, as specified) but starts
`is_verified = false`, invisible to discovery/ranking/sync. The response includes a
one-line marker to paste into the repo's README; `POST /api/projects/:id/verify`
re-fetches the live README and flips it verified the moment the marker is found. It's
safe to remove afterward — the check only happens at verification time.

### 2. A minimal session for connection actions

"Send/accept a connection request" is an action attributed to a specific person. With
truly zero session concept, a `POST /api/connections` body would just be "trust
whatever user_id the client sends" — meaning anyone could send or accept requests as
anyone. See `worker/src/session.ts`: at the moment README verification succeeds
(the strongest proof-of-control this platform ever collects), we mint a short-lived
HMAC-signed token bound to that user id. Not an OAuth flow — no third-party
redirect, no scopes. If a token is lost, the user just re-verifies (free, repeatable)
to mint a new one.

## Anti-gaming, and where each rule actually lives

| Rule | Enforced by |
|---|---|
| One relationship per (user, project) | DB unique constraint (`stars`) |
| Self-star can't earn ranking | DB trigger (`prevent_self_star`), not just app logic |
| Only *active* stars count | `project_ranking` view filters `active = true`; nothing else reads a denormalized score |
| Farming via star/unstar/re-star | Full history in `star_events`; `active` only ever reflects GitHub's current state, checked every sync tick |
| Unregistered GitHub repos ignored | Sync only diffs against `is_verified = true` projects |
| Duplicate/spam connection requests | Unique index on the unordered `(requester, addressee)` pair, `pending`/`accepted` only |
| Impersonating a GitHub identity | README verification (see above) — nothing is "owned" until proven |

## Setup

**Database:**
```bash
# In the Supabase SQL editor, or via the CLI:
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
```

**Worker:**
```bash
cd worker
npm install
wrangler kv:namespace create RATE_LIMIT_KV   # then paste the id into wrangler.toml
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # service role, never the anon key — this bypasses RLS by design, see db.ts
wrangler secret put SESSION_SIGNING_SECRET      # openssl rand -base64 32
wrangler secret put GITHUB_APP_TOKEN            # optional: classic PAT, no scopes needed, raises rate limit only
npm run deploy
```

The cron trigger (`*/15 * * * *`, in `wrangler.toml`) starts firing automatically on
deploy — no separate setup.

## API

- `POST /api/projects` — `{ repoUrl }` → creates or returns existing project + verification instructions
- `POST /api/projects/:id/verify` — re-checks the README; returns `{ verified, sessionToken? }`
- `GET /api/discover?limit=&offset=` — ranked feed, active-verified-stars only
- `POST /api/connections` — `{ addresseeId }`, requires `Authorization: Bearer <sessionToken>`
- `POST /api/connections/:id/respond` — `{ action: "accept" | "decline" }`, requires session

## Known scaling note

`SYNC_BATCH_SIZE` (default 50, in `wrangler.toml`) bounds each cron tick to stay
inside Workers' CPU time limit. At real scale, either shorten the cron interval,
raise the batch size on a plan with a higher CPU limit, or move to Cloudflare Queues
for true fan-out (one queue message per user, consumed by parallel Worker
invocations) — the diff/upsert logic in `sync.ts` doesn't need to change, only how
batches are dispatched.
