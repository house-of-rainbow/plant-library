import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { classesApi, dashboardApi, instancesApi } from "../api";
import type { PlantInstance } from "../types";
import { HEALTH_META, relativeDays } from "../lib/format";
import QrScanner from "../components/QrScanner";
import IdentifyModal from "../components/IdentifyModal";

function CareRow({ plant }: { plant: PlantInstance }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const meta = HEALTH_META[plant.health_status];
  const overdue = plant.care_status.watering_overdue;

  const water = useMutation({
    mutationFn: () => instancesApi.addEvent(plant.id, { type: "watered" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="glass-soft p-4 flex items-center gap-3"
    >
      <button
        onClick={() => navigate(`/plants/${plant.id}`)}
        className="flex items-center gap-3 flex-1 text-left min-w-0"
      >
        <span
          className="h-10 w-10 rounded-full flex items-center justify-center text-lg shrink-0"
          style={{ backgroundColor: `${meta.color}22` }}
        >
          🌿
        </span>
        <div className="min-w-0">
          <div className="font-semibold truncate">
            {plant.nickname || plant.plant_class?.common_name}
          </div>
          <div className={`text-xs ${overdue ? "text-red-300" : "text-white/50"}`}>
            💧 {relativeDays(plant.care_status.days_until_watering)}
            {plant.location ? ` · ${plant.location}` : ""}
          </div>
        </div>
      </button>
      <motion.button
        whileTap={{ scale: 0.9 }}
        className="btn-primary py-2 px-4 shrink-0"
        onClick={() => water.mutate()}
        disabled={water.isPending}
      >
        💧
      </motion.button>
    </motion.div>
  );
}

export default function OperationsPage() {
  const [scanning, setScanning] = useState(false);
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["ops-summary"], queryFn: dashboardApi.summary });
  const { data: classes = [] } = useQuery({ queryKey: ["classes"], queryFn: classesApi.list });

  // Snap → identify → create the plant → jump to its detail to fill in the rest.
  const quickAdd = useMutation({
    mutationFn: ({ classId, imageUrls }: { classId: string; imageUrls: string[] }) =>
      instancesApi.create({ class_id: classId, health_status: "healthy", image_urls: imageUrls }),
    onSuccess: (plant) => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["ops-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      navigate(`/plants/${plant.id}`);
    },
  });

  const queue = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    return [...data.watering_overdue, ...data.watering_due_soon].filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [data]);

  return (
    <div className="space-y-6 pb-10">
      <div className="text-center pt-2">
        <h1 className="font-display text-3xl font-bold">Today's Care</h1>
        <p className="text-white/50">Tap 💧 to log watering instantly.</p>
      </div>

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => setScanning(true)}
        className="w-full glass p-6 flex items-center justify-center gap-3 text-lg font-semibold"
      >
        <span className="text-2xl">📷</span> Scan a plant label
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => setIdentifyOpen(true)}
        className="w-full glass p-6 flex items-center justify-center gap-3 text-lg font-semibold"
      >
        <span className="text-2xl">🔍</span> Identify &amp; add a plant
      </motion.button>

      {queue.length === 0 ? (
        <div className="glass p-10 text-center">
          <div className="text-5xl mb-3">✨</div>
          <p className="text-lg font-medium">All caught up!</p>
          <p className="text-white/50">Nothing needs water right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map((p) => (
            <CareRow key={p.id} plant={p} />
          ))}
        </div>
      )}

      {scanning && <QrScanner onClose={() => setScanning(false)} />}
      <IdentifyModal
        classes={classes}
        open={identifyOpen}
        onClose={() => setIdentifyOpen(false)}
        onUse={(r) => quickAdd.mutate(r)}
      />
    </div>
  );
}
