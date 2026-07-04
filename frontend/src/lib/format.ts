import type { HealthStatus, SunlightLevel } from "../types";

export const HEALTH_META: Record<
  HealthStatus,
  { label: string; color: string; ring: string }
> = {
  thriving: { label: "Thriving", color: "#34d399", ring: "ring-emerald-400/40" },
  healthy: { label: "Healthy", color: "#45bd7b", ring: "ring-canopy-400/40" },
  struggling: { label: "Struggling", color: "#fbbf24", ring: "ring-amber-400/40" },
  critical: { label: "Critical", color: "#f87171", ring: "ring-red-400/40" },
  dormant: { label: "Dormant", color: "#94a3b8", ring: "ring-slate-400/40" },
  deceased: { label: "Deceased", color: "#6b7280", ring: "ring-gray-500/40" },
};

export const SUNLIGHT_META: Record<SunlightLevel, { label: string; icon: string }> = {
  low: { label: "Low light", icon: "🌑" },
  medium: { label: "Medium", icon: "🌤️" },
  bright_indirect: { label: "Bright indirect", icon: "⛅" },
  direct: { label: "Direct sun", icon: "☀️" },
};

export function relativeDays(days?: number | null): string {
  if (days === null || days === undefined) return "—";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `in ${days}d`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
