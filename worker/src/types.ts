export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GITHUB_APP_TOKEN?: string; // optional server-held PAT, raises rate limit only — no user OAuth
  SESSION_SIGNING_SECRET: string; // HMAC key for the lightweight session token, see session.ts
  RATE_LIMIT_KV: KVNamespace;
  SYNC_BATCH_SIZE?: string; // default applied in code if unset
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Same security-header posture as the rest of the platform.
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}
