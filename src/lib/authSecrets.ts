import crypto from "crypto";

/**
 * Constant-time comparison for bearer-token protected internal endpoints
 * (cron, webhooks, etc). Guards against two real mistakes seen in ad-hoc
 * `header === \`Bearer ${secret}\`` checks:
 *
 *  1. If the env var is unset, `secret` is undefined and the template
 *     literal silently becomes the string "Bearer undefined" — which an
 *     attacker can send literally as the header value and pass the check.
 *     This function treats a missing/empty secret as "never authorized".
 *  2. Plain `===` on secrets is not constant-time and can leak information
 *     via timing side-channels; `crypto.timingSafeEqual` avoids that.
 */
export function isAuthorizedBearer(
  authorizationHeader: string | null,
  expectedSecret: string | undefined
): boolean {
  if (!expectedSecret || expectedSecret.length === 0) return false;
  if (!authorizationHeader) return false;

  const expected = `Bearer ${expectedSecret}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(authorizationHeader);

  // timingSafeEqual throws on length mismatch, so pad/short-circuit first
  // without leaking *how* the lengths differ via an early return timing gap
  // that matters (this comparison is against a low-value shared secret, not
  // a per-request nonce, so a coarse length check first is an acceptable
  // trade-off for simplicity).
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
