import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { dashboardApi } from "../api";
import PlantCard from "../components/PlantCard";

function StatCard({
  label,
  value,
  accent,
  delay,
}: {
  label: string;
  value: number | string;
  accent: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, type: "spring", stiffness: 200 }}
      className="glass p-5 relative overflow-hidden"
    >
      <div
        className="absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl opacity-40"
        style={{ background: accent }}
      />
      <div className="text-4xl font-display font-bold" style={{ color: accent }}>
        {value}
      </div>
      <div className="mt-1 text-sm text-white/60">{label}</div>
    </motion.div>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.summary,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold">
          Welcome back 🌱
        </h1>
        <p className="text-white/50 mt-1">
          Here's how your living collection is doing today.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Plants" value={data?.total_plants ?? "—"} accent="#45bd7b" delay={0} />
        <StatCard label="Species" value={data?.total_species ?? "—"} accent="#7dd8a3" delay={0.05} />
        <StatCard
          label="Watering overdue"
          value={data?.watering_overdue_count ?? "—"}
          accent="#f87171"
          delay={0.1}
        />
        <StatCard
          label="Due soon"
          value={data?.watering_due_soon_count ?? "—"}
          accent="#fbbf24"
          delay={0.15}
        />
        <StatCard
          label="Needs attention"
          value={data?.needs_attention_count ?? "—"}
          accent="#ec4899"
          delay={0.2}
        />
      </div>

      {isLoading && <p className="text-white/40">Loading collection…</p>}

      {!!data?.watering_overdue.length && (
        <section>
          <h2 className="font-display text-xl font-semibold mb-4 text-red-300">
            💧 Thirsty — water these now
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {data.watering_overdue.map((p, i) => (
              <PlantCard key={p.id} plant={p} index={i} />
            ))}
          </div>
        </section>
      )}

      {!!data?.needs_attention.length && (
        <section>
          <h2 className="font-display text-xl font-semibold mb-4 text-bloom-400">
            🩺 Needs attention
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {data.needs_attention.map((p, i) => (
              <PlantCard key={p.id} plant={p} index={i} />
            ))}
          </div>
        </section>
      )}

      {data &&
        !data.watering_overdue.length &&
        !data.needs_attention.length &&
        !isLoading && (
          <div className="glass p-10 text-center">
            <div className="text-5xl mb-3">🌿</div>
            <p className="text-lg font-medium">Everything's happy and hydrated.</p>
            <p className="text-white/50">No plants need care right now.</p>
          </div>
        )}
    </div>
  );
}
