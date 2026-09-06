import { Env, errorResponse } from "./types";
import { handleSubmitProject, handleVerifyProject } from "./routes/projects";
import { handleDiscoverFeed } from "./routes/discover";
import { handleCreateConnection, handleRespondConnection } from "./routes/connections";
import { runSyncBatch } from "./sync";
import { getSupabase } from "./db";

const CORS_HEADERS = {
  // Tighten this to your real frontend origin before going to production —
  // left permissive here only because the frontend origin is deployment-
  // specific and not known at scaffold time.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", "projects", ...]

    try {
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "projects" && parts.length === 2) {
        return withCors(await handleSubmitProject(req, env));
      }
      if (
        req.method === "POST" &&
        parts[0] === "api" &&
        parts[1] === "projects" &&
        parts.length === 4 &&
        parts[3] === "verify"
      ) {
        return withCors(await handleVerifyProject(req, env, parts[2]));
      }
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "discover") {
        return withCors(await handleDiscoverFeed(req, env));
      }
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "connections" && parts.length === 2) {
        return withCors(await handleCreateConnection(req, env));
      }
      if (
        req.method === "POST" &&
        parts[0] === "api" &&
        parts[1] === "connections" &&
        parts.length === 4 &&
        parts[3] === "respond"
      ) {
        return withCors(await handleRespondConnection(req, env, parts[2]));
      }

      return withCors(errorResponse("Not found.", 404));
    } catch (err) {
      console.error("Unhandled error", err);
      return withCors(errorResponse("Internal server error.", 500));
    }
  },

  /**
   * Cron Trigger entrypoint (see wrangler.toml [triggers]). Runs the highest-
   * priority feature in the spec: reconciling every user's real GitHub
   * starred set against our `stars` table. Batched and bounded so a single
   * invocation stays within Workers' CPU/time limits — the batch rotates
   * across ticks via `last_synced_at` ordering (see db.ts).
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = getSupabase(env);
    const batchSize = Number(env.SYNC_BATCH_SIZE ?? 50);
    ctx.waitUntil(
      runSyncBatch(db, env.GITHUB_APP_TOKEN, batchSize).then((result) => {
        console.log("sync batch complete", JSON.stringify(result));
      })
    );
  },
};
