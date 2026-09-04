/**
 * Simple in-memory sliding-window rate limiter for our own API routes
 * (separate from GitHub's own rate limits, which are handled in lib/github.ts).
 *
 * NOTE: in-memory state is per-server-instance and does NOT survive
 * restarts or fan out across multiple instances/regions. That's an
 * acceptable starting point for a single-instance deployment, but at real
 * scale (multiple serverless instances, multiple regions) each instance has
 * its own bucket, so effective limits become `limit * instanceCount`. For
 * production traffic, swap this implementation for a shared store (e.g.
 * Upstash Redis via `@upstash/ratelimit`) behind the same `rateLimit()`
 * signature — call sites don't need to change.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Hard cap on tracked keys so a flood of requests from many distinct
// spoofed/rotating identifiers (see getClientIp below) can't grow this map
// without bound and exhaust server memory. When full, the oldest bucket
// (by insertion order) is evicted to make room — a small, bounded amount of
// rate-limit accuracy loss under attack is preferable to unbounded memory
// growth.
const MAX_BUCKETS = 50_000;

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

/**
 * Extracts a best-effort client IP for rate-limit keying.
 *
 * `X-Forwarded-For` can contain a client-supplied value: if the app is
 * deployed behind a trusted reverse proxy/CDN (Vercel, Cloudflare, nginx
 * with `proxy_set_header`), the proxy overwrites or appends to this header
 * before it reaches Next.js, so the *first* entry is generally trustworthy.
 * If you self-host without a trusted proxy in front, this header is fully
 * attacker-controlled and rate limiting can be bypassed by rotating a fake
 * value on every request — in that setup, terminate TLS/proxying with
 * something that sets this header itself (nginx, Caddy, Cloudflare) rather
 * than trusting whatever the client sends directly to Next.js.
 */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "anonymous";
}

// Periodically sweep expired buckets so the map doesn't grow unbounded.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000).unref?.();
}
