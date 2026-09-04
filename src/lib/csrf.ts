/**
 * Defense-in-depth CSRF check for state-changing (non-NextAuth) API routes.
 *
 * NextAuth's session cookie is set with `SameSite=Lax` by default, which
 * already stops browsers from attaching it to cross-site POST requests -
 * that's the primary defense. This adds a second, independent check: the
 * request's `Origin` (falling back to `Referer`) must match our own
 * deployment URL. It costs nothing for legitimate same-site requests from
 * the app's own frontend, and it still helps if a future proxy, browser
 * quirk, or misconfigured cookie attribute ever weakens the SameSite
 * guarantee.
 */
export function assertSameOrigin(req: { headers: { get(name: string): string | null } }): boolean {
  const allowedOrigin = process.env.NEXTAUTH_URL;
  if (!allowedOrigin) {
    // If we don't know our own canonical origin, don't block requests on
    // it - fail open here rather than bricking the app in a misconfigured
    // environment. (NEXTAUTH_URL is required for auth to work at all, so in
    // practice this branch should never be hit in a real deployment.)
    return true;
  }

  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) {
    // Same-site requests from a browser always send Origin on POST/PUT/etc;
    // its absence usually means a non-browser client (curl, server-to-server)
    // which SameSite cookies wouldn't protect against anyway - but since
    // those clients can't present a valid session cookie cross-site either,
    // this is only reached by requests that already passed the session
    // check. Reject to be conservative.
    return false;
  }

  try {
    const originHost = new URL(origin).host;
    const allowedHost = new URL(allowedOrigin).host;
    return originHost === allowedHost;
  } catch {
    return false;
  }
}
