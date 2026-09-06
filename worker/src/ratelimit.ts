/**
 * Fixed-window rate limiter backed by Workers KV.
 *
 * KV is eventually consistent across regions, so this is a coarse-grained
 * abuse deterrent (stop someone scripting thousands of submissions), not a
 * precise limiter — a determined attacker distributed across edge locations
 * could exceed the nominal limit briefly. That's an acceptable trade-off
 * here: the thing actually worth protecting (ranking integrity) is already
 * enforced by the DB constraints and GitHub-is-source-of-truth sync, not by
 * this limiter. This just keeps the submission endpoint from being used to
 * spam-register repos or exhaust the GitHub API quota.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const bucketKey = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  const current = await kv.get(bucketKey);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  await kv.put(bucketKey, String(count + 1), { expirationTtl: windowSeconds * 2 });
  return { allowed: true, remaining: limit - count - 1 };
}

export function getClientIp(req: Request): string {
  // Cloudflare sets this itself at the edge before the request reaches the
  // Worker — unlike a self-hosted X-Forwarded-For, it is not client-supplied
  // and cannot be spoofed by the caller.
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}
