import crypto from "crypto";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Two independent ways to become a "verified builder" (see prisma schema,
 * User.builderVerified):
 *   1. NextAuth/OAuth "instant verify" convenience — a normal cookie session.
 *   2. The zero-permission bio-challenge — no OAuth session at all, so it
 *      gets its own short-lived signed token, delivered as an HttpOnly
 *      cookie (not localStorage — a token readable by JS is exfiltratable
 *      via XSS; HttpOnly means it never touches the JS runtime at all).
 *
 * Both resolve through resolveCurrentBuilderId() so every privileged route
 * *and* server component works identically regardless of which path the
 * user took. Because it reads from next/headers rather than a passed-in
 * Request, this works the same in Route Handlers and Server Components
 * (e.g. the dashboard page) — a bio-verified user can load /dashboard
 * directly, not just call API routes.
 */

export const BUILDER_SESSION_COOKIE = "builder_session";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.BUILDER_SESSION_SECRET;
  if (!secret) {
    throw new Error("BUILDER_SESSION_SECRET is not set. Generate one with: openssl rand -base64 32");
  }
  return secret;
}

function hmac(data: string): string {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function mintBuilderSessionToken(userId: string): string {
  const payload = JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS });
  const encodedPayload = Buffer.from(payload).toString("base64url");
  return `${encodedPayload}.${hmac(encodedPayload)}`;
}

function verifyBuilderSessionToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;

  const expected = hmac(encodedPayload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      sub: string;
      exp: number;
    };
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/**
 * Resolves the current builder's userId via either verification path.
 * Checks the OAuth cookie session first, then the bio-challenge cookie,
 * then (for non-browser API clients) an Authorization: Bearer header.
 */
export async function resolveCurrentBuilderId(): Promise<string | null> {
  const session = await auth();
  if (session?.user) {
    return (session.user as { id: string }).id;
  }

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(BUILDER_SESSION_COOKIE)?.value;
  if (cookieToken) {
    const uid = verifyBuilderSessionToken(cookieToken);
    if (uid) return uid;
  }

  const hdrs = await headers();
  const authHeader = hdrs.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return verifyBuilderSessionToken(authHeader.slice("Bearer ".length).trim());
  }

  return null;
}
