import { Env, errorResponse, jsonResponse } from "../types";
import { parseRepoUrl, fetchRepoMetadata, fetchReadmeText, fetchGithubUser, GitHubApiError } from "../github";
import {
  createProject,
  findOrCreateUser,
  findProjectByRepoId,
  generateVerificationCode,
  getSupabase,
  markProjectVerified,
  ProjectRow,
} from "../db";
import { checkRateLimit, getClientIp } from "../ratelimit";
import { mintSessionToken } from "../session";

function verificationMarker(code: string): string {
  return `<!-- projectstar-verify:${code} -->`;
}

/**
 * POST /api/projects
 * Body: { "repoUrl": "https://github.com/owner/repo" }
 *
 * Frictionless by design: no login. Creates (or finds) a `users` row for
 * the repo's owner and a `projects` row, both unverified until the caller
 * proves control of the repo by adding the returned marker to its README.
 * An unverified project never appears in discovery/ranking and is never
 * included in star sync (see sync.ts — it only iterates
 * `is_verified = true` projects).
 */
export async function handleSubmitProject(req: Request, env: Env): Promise<Response> {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(env.RATE_LIMIT_KV, `submit:${ip}`, 10, 3600);
  if (!rl.allowed) {
    return errorResponse("Too many submissions from this network, try again later.", 429);
  }

  let body: { repoUrl?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body.");
  }
  if (!body.repoUrl || typeof body.repoUrl !== "string") {
    return errorResponse("repoUrl is required.");
  }

  const parsed = parseRepoUrl(body.repoUrl);
  if (!parsed) {
    return errorResponse("repoUrl must look like https://github.com/owner/repo");
  }

  const db = getSupabase(env);

  try {
    const metadata = await fetchRepoMetadata(parsed.owner, parsed.repo, env.GITHUB_APP_TOKEN);

    const existing = await findProjectByRepoId(db, metadata.githubRepoId);
    if (existing) {
      // Idempotent: re-submitting an already-registered repo just returns
      // its current state (including verification instructions if still
      // pending) instead of erroring or creating a duplicate.
      return jsonResponse(projectToPublicShape(existing), 200);
    }

    const owner = await fetchGithubUser(metadata.ownerLogin, env.GITHUB_APP_TOKEN);
    const ownerUser = await findOrCreateUser(db, {
      githubUsername: owner.login,
      githubUserId: owner.id,
      displayName: owner.name,
      avatarUrl: owner.avatarUrl,
    });

    const readmeExcerpt = await safeReadmeExcerpt(parsed.owner, parsed.repo, env.GITHUB_APP_TOKEN);
    const verificationCode = generateVerificationCode();

    const project = await createProject(db, {
      ownerUserId: ownerUser.id,
      githubRepoId: metadata.githubRepoId,
      ownerLogin: metadata.ownerLogin,
      repoName: metadata.repoName,
      fullName: metadata.fullName,
      githubRepoUrl: metadata.htmlUrl,
      description: metadata.description,
      primaryLanguage: metadata.primaryLanguage,
      topics: metadata.topics,
      readmeExcerpt,
      lifetimeStargazersCount: metadata.stargazersCount,
      verificationCode,
    });

    return jsonResponse(projectToPublicShape(project), 201);
  } catch (err) {
    if (err instanceof GitHubApiError) {
      return errorResponse(err.message, err.status === 404 ? 404 : err.status === 429 ? 429 : 502);
    }
    console.error("handleSubmitProject error", err);
    return errorResponse("Failed to register project.", 500);
  }
}

/**
 * POST /api/projects/:id/verify
 * Re-fetches the repo's live README and checks for the marker. This is the
 * only thing that flips `is_verified` — there is no other path to it.
 */
export async function handleVerifyProject(_req: Request, env: Env, projectId: string): Promise<Response> {
  const db = getSupabase(env);
  const { data: project, error } = await db.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (error) {
    console.error("handleVerifyProject lookup error", error);
    return errorResponse("Failed to look up project.", 500);
  }
  if (!project) return errorResponse("Project not found.", 404);
  if (project.is_verified) return jsonResponse(projectToPublicShape(project));

  try {
    const readme = await fetchReadmeText(project.owner_login, project.repo_name, env.GITHUB_APP_TOKEN);
    const marker = verificationMarker(project.verification_code);
    if (!readme.includes(marker)) {
      return jsonResponse(
        { verified: false, instructions: buildInstructions(project.owner_login, project.repo_name, marker) },
        200
      );
    }
    await markProjectVerified(db, project.id);
    const sessionToken = await mintSessionToken(project.owner_user_id, env.SESSION_SIGNING_SECRET);
    return jsonResponse({ verified: true, sessionToken });
  } catch (err) {
    if (err instanceof GitHubApiError) {
      return errorResponse(err.message, err.status === 404 ? 404 : 502);
    }
    console.error("handleVerifyProject error", err);
    return errorResponse("Failed to verify project.", 500);
  }
}

function buildInstructions(owner: string, repo: string, marker: string): string {
  return `Add this exact line anywhere in the README of ${owner}/${repo}, commit it, then retry verification: ${marker} (safe to remove once verified — we only check it at verification time).`;
}

async function safeReadmeExcerpt(owner: string, repo: string, token: string | undefined): Promise<string | null> {
  try {
    const text = await fetchReadmeText(owner, repo, token);
    return text.slice(0, 500);
  } catch {
    return null; // repo may have no README — not a failure condition
  }
}

function projectToPublicShape(project: ProjectRow) {
  const { verification_code, ...rest } = project;
  return {
    ...rest,
    ...(project.is_verified
      ? {}
      : { verificationInstructions: buildInstructions(
          project.owner_login as string,
          project.repo_name as string,
          verificationMarker(verification_code as string)
        ) }),
  };
}
