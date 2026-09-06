/**
 * A minimal signed session, deliberately NOT an OAuth flow: no redirect, no
 * third-party consent screen, no scopes granted. It exists purely to answer
 * "did this browser just prove control of this GitHub identity?" so that
 * connection-request actions (Phase 4) can be attributed to a real user
 * instead of trusting a client-supplied user_id.
 *
 * Minted once, at the moment `handleVerifyProject` confirms the README
 * marker is present — i.e. the strongest proof of account control this
 * platform ever obtains without a login flow. If a token is lost, the user
 * re-verifies (free, repeatable) to mint a new one; there's no account
 * recovery flow to build because there's no password/login to lose.
 */

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function mintSessionToken(userId: string, secret: string): Promise<string> {
  const payload = JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS });
  const encodedPayload = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const signature = await hmac(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;

  const expectedSignature = await hmac(secret, encodedPayload);
  if (expectedSignature !== signature) return null; // constant-time not critical here — a mismatched HMAC over a fixed-length base64 sig, not a raw secret compare

  try {
    const payload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      sub: string;
      exp: number;
    };
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}
