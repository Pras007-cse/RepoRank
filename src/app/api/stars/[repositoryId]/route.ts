import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCurrentBuilderId } from "@/lib/builderSession";
import { syncBuilderStars } from "@/lib/scoring";
import { rateLimit } from "@/lib/rateLimit";
import { z } from "zod";

const paramsSchema = z.object({ repositoryId: z.string().cuid() });

/**
 * POST /api/stars/:repositoryId — "Refresh status" action on the dashboard.
 * Triggers an on-demand full re-sync of this builder's real starred list
 * (there's no cheaper per-repo check anymore since we don't hold a per-user
 * GitHub token — see lib/scoring.ts) and returns this repo's resulting row.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ repositoryId: string }> }
) {
  const userId = await resolveCurrentBuilderId();
  if (!userId) {
    return NextResponse.json({ error: "Verify your builder identity first." }, { status: 401 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid repository id." }, { status: 400 });
  }

  const rl = rateLimit(`reverify:${userId}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many refresh requests, try again shortly." }, { status: 429 });
  }

  await syncBuilderStars(userId);

  const star = await prisma.star.findUnique({
    where: { userId_repositoryId: { userId, repositoryId: parsedParams.data.repositoryId } },
  });
  if (!star) {
    return NextResponse.json({ error: "No star found for this repository yet." }, { status: 404 });
  }
  return NextResponse.json({ star });
}
