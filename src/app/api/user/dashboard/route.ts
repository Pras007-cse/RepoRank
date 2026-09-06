import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const [user, stars, events] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        githubLogin: true,
        image: true,
        githubBio: true,
        contributionScore: true,
        rank: true,
        lastSyncedAt: true,
      },
    }),
    prisma.star.findMany({
      where: { userId, status: { in: ["VERIFIED", "PENDING"] } },
      include: { repository: true },
      orderBy: { verifiedAt: "desc" },
    }),
    prisma.activityEvent.findMany({
      where: { userId },
      include: { repository: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({ user, stars, activity: events });
}
