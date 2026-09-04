import Image from "next/image";

export type LeaderboardUser = {
  id: string;
  name: string | null;
  githubLogin: string | null;
  image: string | null;
  contributionScore?: number;
  categoryScore?: number;
  recentStars?: number;
  rank?: number | null;
};

export default function LeaderboardTable({
  users,
  scoreLabel = "Score",
  scoreKey = "contributionScore",
}: {
  users: LeaderboardUser[];
  scoreLabel?: string;
  scoreKey?: "contributionScore" | "categoryScore" | "recentStars";
}) {
  if (users.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-base-400">
        No ranked developers yet — be the first to star some repos.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-base-700 bg-base-800/50 text-xs uppercase tracking-wide text-base-400">
          <tr>
            <th className="w-16 px-4 py-3">#</th>
            <th className="px-4 py-3">Developer</th>
            <th className="px-4 py-3 text-right">{scoreLabel}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, idx) => (
            <tr key={u.id} className="border-b border-base-800/60 last:border-0 hover:bg-base-800/40">
              <td className="px-4 py-3">
                <RankBadge rank={idx + 1} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {u.image ? (
                    <Image src={u.image} alt={u.name ?? ""} width={32} height={32} className="rounded-full" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-base-700" />
                  )}
                  <div>
                    <p className="font-medium text-base-100">{u.name ?? u.githubLogin}</p>
                    {u.githubLogin && <p className="text-xs text-base-400">@{u.githubLogin}</p>}
                  </div>
                </div>
              </td>
              <td className="mono-num px-4 py-3 text-right font-semibold text-accent-light">
                {(u[scoreKey] ?? 0).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <span className="mono-num flex h-7 w-7 items-center justify-center rounded-md bg-base-800 text-xs font-semibold text-base-300">
      {medal ?? rank}
    </span>
  );
}
