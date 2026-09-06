import { Env, errorResponse, jsonResponse } from "../types";
import { getSupabase } from "../db";

/**
 * GET /api/discover?cursor=&limit=
 * Ranked strictly by `project_ranking.active_verified_stars` (a view over
 * `active = true` rows only — see supabase/schema.sql). Lifetime stars and
 * removed stars are available for display but never used for ordering.
 */
export async function handleDiscoverFeed(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 20;
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  const db = getSupabase(env);

  const { data: ranked, error: rankErr } = await db
    .from("project_ranking")
    .select("*")
    .order("active_verified_stars", { ascending: false })
    .range(offset, offset + limit - 1);
  if (rankErr) {
    console.error("handleDiscoverFeed ranking error", rankErr);
    return errorResponse("Failed to load discovery feed.", 500);
  }
  if (!ranked || ranked.length === 0) return jsonResponse({ projects: [] });

  const projectIds = ranked.map((r: { project_id: string }) => r.project_id);
  const { data: projects, error: projErr } = await db
    .from("projects")
    .select("id, full_name, github_repo_url, description, primary_language, topics, owner_login")
    .in("id", projectIds);
  if (projErr) {
    console.error("handleDiscoverFeed project fetch error", projErr);
    return errorResponse("Failed to load discovery feed.", 500);
  }

  const projectById = new Map((projects ?? []).map((p: { id: string }) => [p.id, p]));
  const merged = ranked.map((r: Record<string, unknown>) => ({
    ...projectById.get(r.project_id as string),
    activeVerifiedStars: r.active_verified_stars,
    lifetimeStarsSeen: r.lifetime_stars_seen,
  }));

  return jsonResponse({ projects: merged });
}
