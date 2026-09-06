import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface UserRow {
  id: string;
  github_username: string;
  github_user_id: number | null;
  display_name: string | null;
  avatar_url: string | null;
  last_synced_at: string | null;
}

export interface ProjectRow {
  id: string;
  owner_user_id: string;
  github_repo_id: number;
  owner_login: string;
  repo_name: string;
  full_name: string;
  github_repo_url: string;
  description: string | null;
  primary_language: string | null;
  topics: string[];
  readme_excerpt: string | null;
  lifetime_stargazers_count: number;
  verification_code: string;
  is_verified: boolean;
  verified_at: string | null;
}

/**
 * A service-role client — this only ever runs inside the Worker, never
 * shipped to a browser, so RLS bypass here is intentional and matches how
 * the schema is designed (all access control is enforced in this data
 * access layer + the DB constraints/triggers, not via row-level policies).
 */
export function getSupabase(env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string }): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export async function findOrCreateUser(
  db: SupabaseClient,
  params: { githubUsername: string; githubUserId: number; displayName: string | null; avatarUrl: string | null }
): Promise<UserRow> {
  const { data: existing, error: findErr } = await db
    .from("users")
    .select("*")
    .eq("github_user_id", params.githubUserId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing as UserRow;

  const { data: created, error: insertErr } = await db
    .from("users")
    .insert({
      github_username: params.githubUsername,
      github_user_id: params.githubUserId,
      display_name: params.displayName,
      avatar_url: params.avatarUrl,
    })
    .select("*")
    .single();
  if (insertErr) throw insertErr;
  return created as UserRow;
}

export function generateVerificationCode(): string {
  // 16 random bytes, hex-encoded — unguessable, and safe to drop straight
  // into a Markdown/HTML comment without escaping.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function findProjectByRepoId(
  db: SupabaseClient,
  githubRepoId: number
): Promise<ProjectRow | null> {
  const { data, error } = await db.from("projects").select("*").eq("github_repo_id", githubRepoId).maybeSingle();
  if (error) throw error;
  return data as ProjectRow | null;
}

export async function createProject(
  db: SupabaseClient,
  params: {
    ownerUserId: string;
    githubRepoId: number;
    ownerLogin: string;
    repoName: string;
    fullName: string;
    githubRepoUrl: string;
    description: string | null;
    primaryLanguage: string | null;
    topics: string[];
    readmeExcerpt: string | null;
    lifetimeStargazersCount: number;
    verificationCode: string;
  }
): Promise<ProjectRow> {
  const { data, error } = await db
    .from("projects")
    .insert({
      owner_user_id: params.ownerUserId,
      github_repo_id: params.githubRepoId,
      owner_login: params.ownerLogin,
      repo_name: params.repoName,
      full_name: params.fullName,
      github_repo_url: params.githubRepoUrl,
      description: params.description,
      primary_language: params.primaryLanguage,
      topics: params.topics,
      readme_excerpt: params.readmeExcerpt,
      lifetime_stargazers_count: params.lifetimeStargazersCount,
      verification_code: params.verificationCode,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ProjectRow;
}

export async function markProjectVerified(db: SupabaseClient, projectId: string): Promise<void> {
  const { error } = await db
    .from("projects")
    .update({ is_verified: true, verified_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw error;
}

/** Users due for a star-sync refresh, oldest/never-synced first. */
export async function selectUsersForSync(db: SupabaseClient, batchSize: number): Promise<UserRow[]> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(batchSize);
  if (error) throw error;
  return (data ?? []) as UserRow[];
}

/** All verified projects, keyed by github_repo_id, for diffing against a user's starred set. */
export async function getVerifiedProjectsByRepoId(db: SupabaseClient): Promise<Map<number, ProjectRow>> {
  const { data, error } = await db.from("projects").select("*").eq("is_verified", true);
  if (error) throw error;
  const map = new Map<number, ProjectRow>();
  for (const row of (data ?? []) as ProjectRow[]) map.set(row.github_repo_id, row);
  return map;
}

export async function getActiveStarredProjectIds(db: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await db.from("stars").select("project_id").eq("from_user_id", userId).eq("active", true);
  if (error) throw error;
  return new Set((data ?? []).map((r: { project_id: string }) => r.project_id));
}

export async function recordStarEvent(
  db: SupabaseClient,
  params: { fromUserId: string; projectId: string; eventType: "STAR" | "UNSTAR" }
): Promise<void> {
  const { error } = await db.from("star_events").insert({
    from_user_id: params.fromUserId,
    project_id: params.projectId,
    event_type: params.eventType,
  });
  if (error) throw error;
}

export async function upsertStarActive(
  db: SupabaseClient,
  params: { fromUserId: string; projectId: string; active: boolean }
): Promise<{ skipped: boolean }> {
  const now = new Date().toISOString();
  const { error } = await db.from("stars").upsert(
    {
      from_user_id: params.fromUserId,
      project_id: params.projectId,
      active: params.active,
      last_verified_at: now,
    },
    { onConflict: "from_user_id,project_id" }
  );
  // The self-star trigger raises a Postgres exception rather than failing
  // silently — surface it as "skipped" so the sync loop can log and move on
  // instead of aborting the whole batch over one bad row.
  if (error) {
    if (error.message?.includes("self-star is not allowed")) {
      return { skipped: true };
    }
    throw error;
  }
  return { skipped: false };
}

export async function touchUserSyncedAt(db: SupabaseClient, userId: string): Promise<void> {
  const { error } = await db.from("users").update({ last_synced_at: new Date().toISOString() }).eq("id", userId);
  if (error) throw error;
}
