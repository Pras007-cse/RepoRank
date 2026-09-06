export default function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-base-400">{label}</p>
      <p className="mono-num mt-2 text-3xl font-semibold text-base-100">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-base-400">{sublabel}</p>}
    </div>
  );
}
