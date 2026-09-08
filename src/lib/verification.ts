import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { fetchGithubUserProfile } from "@/lib/github";
import { mintBuilderSessionToken } from "@/lib/builderSession";

const CHALLENGE_TTL_MS = 15 * 60 * 1000; // short-lived, per the spec's requirements
const CHALLENGE_PREFIX = "PS-";

function generateChallengeCode(): string {
  // 5 random base32-ish chars after the prefix, e.g. PS-7K2M9 — matches the
  // spec's example shape, cryptographically random, single-use (see below).
  const bytes = crypto.randomBytes(5);
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I ambiguity
  let code = "";
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return CHALLENGE_PREFIX + code;
}

function hashChallenge(code: string): string {
  // Stored hashed per the spec ("stored hashed where appropriate"). The code
  // is necessarily public (it's sitting in the person's GitHub bio) during
  // the verification window, so this isn't defending the code's secrecy —
  // it just means a DB read alone can't produce a currently-valid challenge
  // for an account the reader doesn't already know the pending code for.
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Starts (or restarts) the ownership-verification challenge for a claimed
 * GitHub username. Does NOT require any existing session — this is exactly
 * the progressive-auth entry point: identity is established as a result of
 * completing this, not a precondition for starting it.
 */
export async function startVerificationChallenge(githubUsername: string): Promise<{ code: string }> {
  const code = generateChallengeCode();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  // find-or-create a User row keyed by githubLogin — this is a *pending*
  // identity claim, not yet verified. builderVerified stays false until
  // confirmChallenge succeeds.
  const existing = await prisma.user.findUnique({ where: { githubLogin: githubUsername } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { verificationChallengeHash: hashChallenge(code), verificationChallengeExpiresAt: expiresAt },
    });
  } else {
    await prisma.user.create({
      data: {
        githubLogin: githubUsername,
        verificationChallengeHash: hashChallenge(code),
        verificationChallengeExpiresAt: expiresAt,
      },
    });
  }

  return { code };
}

/** Auto-claims any registered repo whose real GitHub owner matches a now-verified
 * identity — ownership always follows GitHub's own owner field, never who
 * submitted the URL. Shared by both verification paths (bio-challenge and OAuth). */
export async function autoClaimReposForUser(userId: string, githubUsername: string) {
  const claimable = await prisma.repository.findMany({
    where: { owner: githubUsername, ownerUserId: null },
    select: { id: true, fullName: true },
  });
  if (claimable.length === 0) return;

  const now = new Date();
  type ClaimableRow = { id: string; fullName: string };
  await prisma.$transaction([
    prisma.repository.updateMany({
      where: { id: { in: claimable.map((r: ClaimableRow) => r.id) } },
      data: { ownerUserId: userId, claimedAt: now },
    }),
    prisma.activityEvent.createMany({
      data: claimable.map((r: ClaimableRow) => ({
        userId,
        repositoryId: r.id,
        type: "PROJECT_CLAIMED" as const,
        message: `Automatically claimed ${r.fullName} on verification (GitHub owner match).`,
      })),
    }),
  ]);
}

export type ConfirmResult =
  | { ok: true; userId: string; sessionToken: string }
  | { ok: false; reason: "no_pending_challenge" | "expired" | "code_not_found_in_bio" | "github_lookup_failed" };

/**
 * Re-fetches the *live* public GitHub bio for `githubUsername` and checks
 * for the pending challenge code. Server-side only — never trusts a
 * client-supplied "I added it" claim. Single-use: the challenge is cleared
 * immediately on success (or failure past expiry), so it can't be replayed.
 */
export async function confirmVerificationChallenge(githubUsername: string): Promise<ConfirmResult> {
  const pending = await prisma.user.findUnique({ where: { githubLogin: githubUsername } });
  if (!pending?.verificationChallengeHash || !pending.verificationChallengeExpiresAt) {
    return { ok: false, reason: "no_pending_challenge" };
  }
  if (pending.verificationChallengeExpiresAt.getTime() < Date.now()) {
    await prisma.user.update({
      where: { id: pending.id },
      data: { verificationChallengeHash: null, verificationChallengeExpiresAt: null },
    });
    return { ok: false, reason: "expired" };
  }

  let profile;
  try {
    profile = await fetchGithubUserProfile(githubUsername);
  } catch {
    return { ok: false, reason: "github_lookup_failed" };
  }

  // We don't have the plaintext code anymore (only its hash), so we can't
  // directly compare — instead, search the bio for the PS- prefixed token
  // shape and hash *that* to compare against what we stored. This still
  // never trusts anything the client sent; the bio content came straight
  // from GitHub's API in this same request.
  const candidate = (profile.bio ?? "").match(/PS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}/)?.[0];
  if (!candidate || hashChallenge(candidate) !== pending.verificationChallengeHash) {
    return { ok: false, reason: "code_not_found_in_bio" };
  }

  const now = new Date();
  await prisma.user.update({
    where: { id: pending.id },
    data: {
      githubId: profile.id,
      name: pending.name ?? profile.name,
      image: pending.image ?? profile.avatarUrl,
      builderVerified: true,
      verifiedAt: now,
      verificationChallengeHash: null,
      verificationChallengeExpiresAt: null,
    },
  });

  // Auto-claim any registered repo whose real GitHub owner matches this
  // now-verified identity — ownership is determined by GitHub's own owner
  // field, never by who happened to submit the URL.
  await autoClaimReposForUser(pending.id, githubUsername);
  await prisma.activityEvent.create({
    data: { userId: pending.id, type: "BUILDER_VERIFIED", message: "Verified builder identity via GitHub bio challenge." },
  });

  return { ok: true, userId: pending.id, sessionToken: mintBuilderSessionToken(pending.id) };
}
