import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmVerificationChallenge } from "@/lib/verification";
import { BUILDER_SESSION_COOKIE } from "@/lib/builderSession";
import { rateLimit } from "@/lib/rateLimit";

const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const bodySchema = z.object({ githubUsername: z.string().regex(GITHUB_USERNAME_RE) });

const REASON_STATUS: Record<string, number> = {
  no_pending_challenge: 404,
  expired: 410,
  code_not_found_in_bio: 422,
  github_lookup_failed: 502,
};

const REASON_MESSAGE: Record<string, string> = {
  no_pending_challenge: "No pending verification for this username — start one first.",
  expired: "The verification code expired. Start a new challenge.",
  code_not_found_in_bio: "Code not found in this account's public GitHub bio yet. Double-check it's saved, then retry.",
  github_lookup_failed: "Couldn't reach GitHub to check the profile. Try again shortly.",
};

/**
 * POST /api/builder/verify/confirm — re-fetches the live public GitHub bio
 * server-side and checks for the pending challenge. Never trusts a
 * client-supplied "I added it" claim; the only source of truth is what
 * GitHub's API returns in this request.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  const ipLimit = rateLimit(`verify-confirm-ip:${ip}`, { limit: 30, windowMs: 3600_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many attempts, try again later." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "githubUsername is required and must be a valid GitHub username." }, { status: 400 });
  }

  const result = await confirmVerificationChallenge(parsed.data.githubUsername);
  if (!result.ok) {
    return NextResponse.json(
      { verified: false, error: REASON_MESSAGE[result.reason] },
      { status: REASON_STATUS[result.reason] ?? 400 }
    );
  }

  const res = NextResponse.json({ verified: true });
  res.cookies.set(BUILDER_SESSION_COOKIE, result.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days, matches the token's own TTL
  });
  return res;
}
