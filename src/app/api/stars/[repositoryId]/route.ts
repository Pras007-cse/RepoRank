import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reverifyStar } from "@/lib/scoring";
import { rateLimit } from "@/lib/rateLimit";

/**
 * POST /api/stars/:repositoryId — force an on-demand re-check of this star
 * against GitHub. Used by the dashboard's "Refresh status" action, and as
 * the same code path the webhook and periodic job call.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repositoryId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const rl = rateLimit(`reverify:${userId}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many refresh requests, try again shortly." }, { status: 429 });
  }

  const { repositoryId } = await params;
  const star = await reverifyStar(userId, repositoryId);
  if (!star) {
    return NextResponse.json({ error: "Star not found." }, { status: 404 });
  }
  return NextResponse.json({ star });
}
