import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import type { PlantInstance } from "../types";
import { HEALTH_META, relativeDays } from "../lib/format";
import { formatPlantLocation } from "../lib/plantLocation";
import { useTenant } from "../tenant/TenantContext";
import PlantOrb from "../three/PlantOrb";

export default function PlantCard({
  plant,
  index = 0,
}: {
  plant: PlantInstance;
  index?: number;
}) {
  const navigate = useNavigate();
  const { property, gardens } = useTenant();
  const meta = HEALTH_META[plant.health_status];
  const title = plant.nickname || plant.plant_class?.common_name || "Unnamed plant";
  const overdue = plant.care_status.watering_overdue;
  const cover = plant.image_urls[0] || plant.plant_class?.hero_image_url || null;
  const locationLabel = formatPlantLocation(plant, property, gardens);

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 24, rotateX: -8 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 260, damping: 24 }}
      whileHover={{ y: -6, rotateX: 4, rotateY: -4 }}
      onClick={() => navigate(`/plants/${plant.id}`)}
      style={{ transformStyle: "preserve-3d", perspective: 1000 }}
      className={`group relative text-left glass overflow-hidden ring-1 ${meta.ring}`}
    >
      {/* Media */}
      <div className="relative h-40 w-full overflow-hidden">
        {cover ? (
          <img
            src={cover}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
        ) : (
          <div className="absolute inset-0">
            <PlantOrb health={plant.health_status} className="h-full w-full" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <span
          className="pill absolute top-3 left-3 text-white"
          style={{ backgroundColor: `${meta.color}33`, color: meta.color }}
        >
          ● {meta.label}
        </span>
        {overdue && (
          <span className="pill absolute top-3 right-3 bg-red-500/90 text-white animate-pulse">
            💧 Overdue
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        <h3 className="font-display text-lg font-semibold leading-tight">{title}</h3>
        <p className="text-sm text-white/50 italic">
          {plant.plant_class?.scientific_name || plant.plant_class?.common_name || "—"}
        </p>

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-white/50">
            {`📍 ${locationLabel}`}
          </span>
          <span
            className={`font-medium ${
              overdue ? "text-red-300" : "text-canopy-300"
            }`}
          >
            💧 {relativeDays(plant.care_status.days_until_watering)}
          </span>
        </div>
      </div>
    </motion.button>
  );
}
