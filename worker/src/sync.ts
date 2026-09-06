import { SupabaseClient } from "@supabase/supabase-js";
import { fetchStarredRepoIds, GitHubApiError } from "./github";
import {
  getActiveStarredProjectIds,
  getVerifiedProjectsByRepoId,
  recordStarEvent,
  selectUsersForSync,
  touchUserSyncedAt,
  upsertStarActive,
  ProjectRow,
  UserRow,
} from "./db";

export interface SyncResult {
  usersProcessed: number;
  starsAdded: number;
  starsRemoved: number;
  usersSkippedDueToRateLimit: number;
  errors: string[];
}

/**
 * One cron tick: pull a bounded batch of users, and for each, reconcile
 * their real GitHub starred set against our `stars` table.
 *
 * GitHub is always the source of truth — we never trust a client-submitted
 * "I starred this" claim. A STAR/UNSTAR event and the corresponding
 * `active` flip only ever happen because the public starred-repos API told
 * us so.
 */
export async function runSyncBatch(
  db: SupabaseClient,
  githubToken: string | undefined,
  batchSize: number
): Promise<SyncResult> {
  const result: SyncResult = {
    usersProcessed: 0,
    starsAdded: 0,
    starsRemoved: 0,
    usersSkippedDueToRateLimit: 0,
    errors: [],
  };

  const [users, verifiedProjectsByRepoId] = await Promise.all([
    selectUsersForSync(db, batchSize),
    getVerifiedProjectsByRepoId(db),
  ]);

  if (verifiedProjectsByRepoId.size === 0) {
    // Nothing verified yet to compare against — still touch users so the
    // batch rotates instead of retrying the same empty-project window.
    for (const user of users) await touchUserSyncedAt(db, user.id);
    return result;
  }

  for (const user of users) {
    try {
      await syncOneUser(db, user, githubToken, verifiedProjectsByRepoId, result);
      result.usersProcessed += 1;
    } catch (err) {
      if (err instanceof GitHubApiError && err.status === 429) {
        result.usersSkippedDueToRateLimit += 1;
        // Don't touch last_synced_at — retry this user next tick instead of
        // pushing them to the back of the queue because of our own rate limit.
        continue;
      }
      result.errors.push(`user ${user.github_username}: ${(err as Error).message}`);
    }
  }

  return result;
}

async function syncOneUser(
  db: SupabaseClient,
  user: UserRow,
  githubToken: string | undefined,
  verifiedProjectsByRepoId: Map<number, ProjectRow>,
  result: SyncResult
): Promise<void> {
  const [starredRepoIds, currentlyActiveProjectIds] = await Promise.all([
    fetchStarredRepoIds(user.github_username, githubToken),
    getActiveStarredProjectIds(db, user.id),
  ]);

  // Only registered, verified student projects count — GitHub repos the
  // user starred that aren't on the platform are irrelevant noise.
  const newlyIntersectingProjectIds = new Set<string>();
  for (const [repoId, project] of verifiedProjectsByRepoId) {
    if (starredRepoIds.has(repoId)) newlyIntersectingProjectIds.add(project.id);
  }

  // New stars: in the fresh intersection, not already active.
  for (const projectId of newlyIntersectingProjectIds) {
    if (currentlyActiveProjectIds.has(projectId)) continue;
    const { skipped } = await upsertStarActive(db, { fromUserId: user.id, projectId, active: true });
    if (skipped) continue; // self-star, rejected by the DB trigger
    await recordStarEvent(db, { fromUserId: user.id, projectId, eventType: "STAR" });
    result.starsAdded += 1;
  }

  // Removed stars: previously active, missing from the fresh set.
  for (const projectId of currentlyActiveProjectIds) {
    if (newlyIntersectingProjectIds.has(projectId)) continue;
    await upsertStarActive(db, { fromUserId: user.id, projectId, active: false });
    await recordStarEvent(db, { fromUserId: user.id, projectId, eventType: "UNSTAR" });
    result.starsRemoved += 1;
  }

  await touchUserSyncedAt(db, user.id);
}
