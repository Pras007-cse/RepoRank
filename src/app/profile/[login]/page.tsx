import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import StatCard from "@/components/StatCard";

export default async function ProfilePage({ params }: { params: { login: string } }) {
  const user = await prisma.user.findUnique({
    where: { githubLogin: params.login },
  });
  if (!user) notFound();

  const stars = await prisma.star.findMany({
    where: { userId: user.id, status: "VERIFIED" },
    include: { repository: true },
    orderBy: { verifiedAt: "desc" },
    take: 20,
  });

  return (
    <div>
      <div className="flex items-center gap-4">
        {user.image && (
          <Image src={user.image} alt={user.name ?? ""} width={72} height={72} className="rounded-full ring-2 ring-base-700" />
        )}
        <div>
          <h1 className="text-2xl font-semibold text-base-100">{user.name ?? user.githubLogin}</h1>
          <p className="text-sm text-base-400">@{user.githubLogin}</p>
        </div>
      </div>
      {user.githubBio && <p className="mt-4 max-w-xl text-sm text-base-300">{user.githubBio}</p>}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Contribution score" value={user.contributionScore} />
        <StatCard label="Global rank" value={user.rank ? `#${user.rank}` : "Unranked"} />
        <StatCard label="Verified stars" value={stars.length} />
      </div>

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-base-400">
        Verified contributions
      </h2>
      <div className="card divide-y divide-base-800">
        {stars.length === 0 && <p className="p-4 text-sm text-base-400">No verified stars yet.</p>}
        {stars.map((s: (typeof stars)[number]) => (
          <a
            key={s.id}
            href={s.repository.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-4 hover:bg-base-800/40"
          >
            <span className="text-sm text-base-100">{s.repository.fullName}</span>
            <span className="mono-num text-xs text-base-400">★ {s.repository.stargazersCount.toLocaleString()}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
