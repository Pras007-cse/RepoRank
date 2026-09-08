import { redirect } from "next/navigation";
import { resolveCurrentBuilderId } from "@/lib/builderSession";
import { prisma } from "@/lib/prisma";
import StatCard from "@/components/StatCard";
import DashboardStarsList from "@/components/DashboardStarsList";

export default async function DashboardPage() {
  const userId = await resolveCurrentBuilderId();
  if (!userId) {
    redirect("/");
  }

  const [user, stars, activity, totalRanked] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.star.findMany({
      where: { userId },
      include: { repository: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.activityEvent.findMany({
      where: { userId },
      include: { repository: true },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.user.count({ where: { contributionScore: { gt: 0 } } }),
  ]);

  const verifiedCount = stars.filter((s: { status: string }) => s.status === "VERIFIED").length;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-base-100">Your dashboard</h1>
      <p className="mt-1 text-sm text-base-400">
        Synced with GitHub {user?.lastSyncedAt ? `· last synced ${timeAgo(user.lastSyncedAt)}` : ""}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Contribution score" value={user?.contributionScore ?? 0} />
        <StatCard
          label="Global rank"
          value={user?.rank ? `#${user.rank}` : "Unranked"}
          sublabel={totalRanked > 0 ? `out of ${totalRanked} ranked developers` : undefined}
        />
        <StatCard label="Verified stars" value={verifiedCount} sublabel={`${stars.length} total tracked`} />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-base-400">
            Starred repositories
          </h2>
          <DashboardStarsList
            stars={stars.map((s: (typeof stars)[number]) => ({
              id: s.id,
              repositoryId: s.repositoryId,
              status: s.status,
              verifiedAt: s.verifiedAt?.toISOString() ?? null,
              repository: {
                fullName: s.repository.fullName,
                url: s.repository.url,
                stargazersCount: s.repository.stargazersCount,
                language: s.repository.language,
              },
            }))}
          />
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-base-400">
            Activity history
          </h2>
          <div className="card divide-y divide-base-800">
            {activity.length === 0 && (
              <p className="p-4 text-sm text-base-400">No activity yet — star a repo to get started.</p>
            )}
            {activity.map((e: (typeof activity)[number]) => (
              <div key={e.id} className="p-4">
                <p className="text-sm text-base-200">{e.message}</p>
                <p className="mt-1 text-xs text-base-500">{timeAgo(e.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  const intervals: [number, string][] = [
    [31536000, "y"],
    [2592000, "mo"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [secs, label] of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) return `${count}${label} ago`;
  }
  return "just now";
}
