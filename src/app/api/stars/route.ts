import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCurrentBuilderId } from "@/lib/builderSession";

/**
 * GET /api/stars — the current verified builder's currently-tracked stars.
 * There is no POST here anymore: this app never stars anything on GitHub on
 * a user's behalf. Real stars happen on github.com itself; this endpoint
 * only reflects what the periodic sync job (lib/scoring.ts) has detected.
 */
export async function GET() {
  const userId = await resolveCurrentBuilderId();
  if (!userId) {
    return NextResponse.json({ error: "Verify your builder identity first." }, { status: 401 });
  }

  const stars = await prisma.star.findMany({
    where: { userId },
    include: { repository: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ stars });
}
