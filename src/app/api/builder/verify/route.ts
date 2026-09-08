import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startVerificationChallenge } from "@/lib/verification";
import { rateLimit } from "@/lib/rateLimit";

const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const bodySchema = z.object({ githubUsername: z.string().regex(GITHUB_USERNAME_RE) });

/**
 * POST /api/builder/verify — starts (or restarts) the zero-permission
 * ownership-verification challenge. No session required: this is the
 * progressive-auth entry point itself, not something gated behind auth.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  // Two limits: per-IP (stop one client from spamming challenges for many
  // usernames) and per-username (stop hammering one account with challenge
  // resets, which would just be noisy/annoying, not actually exploitable
  // since only the real bio holder can ever satisfy any given challenge).
  const ipLimit = rateLimit(`verify-challenge-ip:${ip}`, { limit: 20, windowMs: 3600_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many verification attempts, try again later." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "githubUsername is required and must be a valid GitHub username." }, { status: 400 });
  }

  const userLimit = rateLimit(`verify-challenge-user:${parsed.data.githubUsername}`, { limit: 5, windowMs: 3600_000 });
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many verification attempts for this account, try again later." }, { status: 429 });
  }

  const { code } = await startVerificationChallenge(parsed.data.githubUsername);
  return NextResponse.json({
    code,
    instructions: `Add "${code}" anywhere in your GitHub profile bio (github.com/settings/profile), save, then confirm. Expires in 15 minutes; you can remove it right after confirming.`,
  });
}
