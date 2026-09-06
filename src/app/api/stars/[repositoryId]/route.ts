import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reverifyStar } from "@/lib/scoring";
import { rateLimit } from "@/lib/rateLimit";
import { assertSameOrigin } from "@/lib/csrf";
import { z } from "zod";

const paramsSchema = z.object({ repositoryId: z.string().cuid() });

/**
 * POST /api/stars/:repositoryId — force an on-demand re-check of this star
 * against GitHub. Used by the dashboard's "Refresh status" action, and as
 * the same code path the webhook and periodic job call.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { repositoryId: string } }
) {
  if (!assertSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const parsedParams = paramsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid repository id." }, { status: 400 });
  }

  const rl = rateLimit(`reverify:${userId}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many refresh requests, try again shortly." }, { status: 429 });
  }

  const star = await reverifyStar(userId, parsedParams.data.repositoryId);
  if (!star) {
    return NextResponse.json({ error: "Star not found." }, { status: 404 });
  }
  return NextResponse.json({ star });
}
