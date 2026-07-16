import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import type { EventType, PlantInstance } from "../types";
import { instancesApi, scanApi } from "../api";
import { HEALTH_META, SUNLIGHT_META, formatDate, relativeDays } from "../lib/format";
import { formatPlantLocation } from "../lib/plantLocation";
import { useTenant } from "../tenant/TenantContext";
import PlantOrb from "../three/PlantOrb";

const EVENT_LABELS: Record<EventType, string> = {
  watered: "💧 Watered",
  fertilized: "🧪 Fertilized",
  repotted: "🪴 Repotted",
  pruned: "✂️ Pruned",
  pest_treatment: "🐛 Pest treatment",
  note: "📝 Note",
  health_change: "❤️ Health change",
  moved: "📦 Moved",
};

/**
 * Rich plant detail view. Reused by the desktop detail page and the mobile
 * scan landing page. `compact` tightens spacing for mobile.
 */
export default function PlantDetail({
  plant,
  compact = false,
}: {
  plant: PlantInstance;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { property, gardens } = useTenant();
  const meta = HEALTH_META[plant.health_status];
  const care = plant.care_status.effective_care;
  const title = plant.nickname || plant.plant_class?.common_name || "Plant";
  const locationLabel = formatPlantLocation(plant, property, gardens);

  const logEvent = useMutation({
    mutationFn: (type: EventType) =>
      instancesApi.addEvent(plant.property_id, plant.id, { type }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instance", plant.id] });
      qc.invalidateQueries({ queryKey: ["scan", plant.id] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const cover = plant.image_urls[0] || plant.plant_class?.hero_image_url || null;

  return (
    <div className={`space-y-6 ${compact ? "" : "sm:space-y-8"}`}>
      {/* Hero */}
      <div className="glass overflow-hidden">
        <div className="relative h-56 sm:h-72">
          {cover ? (
            <img src={cover} alt={title} className="h-full w-full object-cover" />
          ) : (
            <PlantOrb health={plant.health_status} className="h-full w-full" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
          <div className="absolute bottom-4 left-5 right-5">
            <span
              className="pill mb-2"
              style={{ backgroundColor: `${meta.color}33`, color: meta.color }}
            >
              ● {meta.label}
            </span>
            <h1 className="font-display text-3xl font-bold">{title}</h1>
            <p className="text-white/60 italic">
              {plant.plant_class?.scientific_name || plant.plant_class?.common_name}
            </p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <motion.button
          whileTap={{ scale: 0.94 }}
          className="btn-primary"
          onClick={() => logEvent.mutate("watered")}
          disabled={logEvent.isPending}
        >
          💧 Water
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.94 }}
          className="btn-ghost"
          onClick={() => logEvent.mutate("fertilized")}
        >
          🧪 Fertilize
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.94 }}
          className="btn-ghost"
          onClick={() => logEvent.mutate("repotted")}
        >
          🪴 Repot
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.94 }}
          className="btn-ghost"
          onClick={() => logEvent.mutate("pruned")}
        >
          ✂️ Prune
        </motion.button>
      </div>

      {/* Care grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-soft p-4">
          <div className="text-xs uppercase tracking-wider text-white/40">Watering</div>
          <div
            className={`text-lg font-semibold ${
              plant.care_status.watering_overdue ? "text-red-300" : "text-canopy-300"
            }`}
          >
            {relativeDays(plant.care_status.days_until_watering)}
          </div>
          <div className="text-xs text-white/40">
            Last: {formatDate(plant.last_watered_at)}
          </div>
        </div>
        <div className="glass-soft p-4">
          <div className="text-xs uppercase tracking-wider text-white/40">Sunlight</div>
          <div className="text-lg font-semibold">
            {care.sunlight ? SUNLIGHT_META[care.sunlight].label : "—"}
          </div>
        </div>
        <div className="glass-soft p-4">
          <div className="text-xs uppercase tracking-wider text-white/40">Fertilizing</div>
          <div className="text-lg font-semibold">
            {care.fertilizing_interval_days
              ? `Every ${care.fertilizing_interval_days}d`
              : "—"}
          </div>
          {care.fertilizer_type && (
            <div className="text-xs text-white/40">{care.fertilizer_type}</div>
          )}
        </div>
        <div className="glass-soft p-4">
          <div className="text-xs uppercase tracking-wider text-white/40">Location</div>
          <div className="text-lg font-semibold">{locationLabel}</div>
        </div>
        <div className="glass-soft p-4">
          <div className="text-xs uppercase tracking-wider text-white/40">Acquired</div>
          <div className="text-lg font-semibold">{formatDate(plant.acquisition_date)}</div>
        </div>
      </div>

      {care.care_notes && (
        <div className="glass-soft p-5">
          <div className="text-xs uppercase tracking-wider text-white/40 mb-1">Care notes</div>
          <p className="text-white/80">{care.care_notes}</p>
        </div>
      )}

      {(() => {
        const details: [string, string | null | undefined][] = [
          ["Fertilizer", care.fertilizer_notes],
          ["Watering", care.watering_notes],
          ["Light", care.light_notes],
          ["Soil", care.soil_type],
          ["Pot size", plant.pot_size || care.pot_size],
          ["Mature size", care.mature_size],
          ["Hardiness zone", care.hardiness_zone],
          ["Pruning", care.pruning_notes],
          ["Propagation", care.propagation_notes],
          ["Pests & treatments", care.pests_notes],
        ];
        const shown = details.filter(([, v]) => !!v);
        if (!shown.length && !care.toxic_to_pets) return null;
        return (
          <div className="glass-soft p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">Care details</h3>
              {care.toxic_to_pets && (
                <span className="pill bg-red-500/15 text-red-300">☠️ Toxic to pets</span>
              )}
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {shown.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase tracking-wider text-white/40">{k}</dt>
                  <dd className="text-white/80 text-sm whitespace-pre-wrap">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })()}

      {/* Event log */}
      <div className="glass-soft p-5">
        <h3 className="font-display text-lg font-semibold mb-3">Care history</h3>
        {plant.events.length === 0 ? (
          <p className="text-white/40 text-sm">No care logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {plant.events.slice(0, 12).map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between text-sm border-b border-white/5 pb-2 last:border-0"
              >
                <span>{EVENT_LABELS[ev.type]}</span>
                <span className="text-white/40">{formatDate(ev.occurred_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Label */}
      {!compact && (
        <div className="glass-soft p-5 flex items-center gap-5">
          <img
            src={scanApi.qrUrl(plant.id)}
            alt="QR label"
            className="h-32 w-32 rounded-xl bg-white p-2"
          />
          <div>
            <h3 className="font-display text-lg font-semibold">Scan label</h3>
            <p className="text-sm text-white/50">
              Print this QR or write the URL to an NFC tag. Scanning opens this plant instantly.
            </p>
            <code className="mt-2 block text-xs text-canopy-300 break-all">
              {plant.scan_url}
            </code>
          </div>
        </div>
      )}
    </div>
  );
}
