import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { classesApi, imagesApi, instancesApi, type InstanceCreate } from "../api";
import type { HealthStatus, PlantInstance } from "../types";
import { HEALTH_META } from "../lib/format";
import { useTenant } from "../tenant/TenantContext";

const HEALTH_OPTIONS: HealthStatus[] = [
  "thriving",
  "healthy",
  "struggling",
  "critical",
  "dormant",
  "deceased",
];

interface FormState {
  class_id: string;
  garden_id: string;
  nickname: string;
  location: string;
  acquisition_date: string;
  pot_size: string;
  soil_type: string;
  health_status: HealthStatus;
  notes: string;
  image_urls: string[];
}

function toForm(p: PlantInstance): FormState {
  return {
    class_id: p.class_id,
    garden_id: p.garden_id,
    nickname: p.nickname ?? "",
    location: p.location ?? "",
    acquisition_date: p.acquisition_date ?? "",
    pot_size: p.pot_size ?? "",
    soil_type: p.soil_type ?? "",
    health_status: p.health_status,
    notes: p.notes ?? "",
    image_urls: p.image_urls ?? [],
  };
}

function toPayload(f: FormState): Partial<InstanceCreate> {
  return {
    class_id: f.class_id,
    garden_id: f.garden_id,
    nickname: f.nickname.trim() || undefined,
    location: f.location.trim() || undefined,
    acquisition_date: f.acquisition_date || undefined,
    pot_size: f.pot_size.trim() || undefined,
    soil_type: f.soil_type.trim() || undefined,
    health_status: f.health_status,
    notes: f.notes.trim() || undefined,
    image_urls: f.image_urls,
  };
}

export default function InstanceEditModal({
  plant,
  open,
  onClose,
}: {
  plant: PlantInstance;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { gardens } = useTenant();
  const [form, setForm] = useState<FormState>(() => toForm(plant));
  const [uploading, setUploading] = useState(false);

  // Re-sync the form with the latest instance data each time the modal opens.
  useEffect(() => {
    if (open) setForm(toForm(plant));
  }, [open, plant]);

  const { data: classes = [] } = useQuery({
    queryKey: ["classes", plant.property_id],
    queryFn: () => classesApi.list(plant.property_id),
  });

  const save = useMutation({
    mutationFn: () => instancesApi.update(plant.property_id, plant.id, toPayload(form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instance", plant.property_id, plant.id] });
      qc.invalidateQueries({ queryKey: ["scan", plant.id] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await imagesApi.upload(file);
      setForm((f) => ({ ...f, image_urls: [...f.image_urls, url] }));
    } finally {
      setUploading(false);
    }
  }

  function removeImage(url: string) {
    setForm((f) => ({ ...f, image_urls: f.image_urls.filter((u) => u !== url) }));
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.form
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="glass w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto no-scrollbar"
          >
            <h2 className="font-display text-2xl font-bold">Edit plant</h2>

            <div>
              <label className="label">Species *</label>
              <select
                className="input"
                required
                value={form.class_id}
                onChange={(e) => setForm({ ...form, class_id: e.target.value })}
              >
                <option value="">Select a species…</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.common_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Garden *</label>
              <select
                className="input"
                required
                value={form.garden_id}
                onChange={(e) => setForm({ ...form, garden_id: e.target.value })}
              >
                {gardens.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nickname</label>
                <input
                  className="input"
                  value={form.nickname}
                  onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                  placeholder="Monty"
                />
              </div>
              <div>
                <label className="label">Location</label>
                <input
                  className="input"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Living room"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Acquired</label>
                <input
                  type="date"
                  className="input"
                  value={form.acquisition_date}
                  onChange={(e) => setForm({ ...form, acquisition_date: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Pot size</label>
                <input
                  className="input"
                  value={form.pot_size}
                  onChange={(e) => setForm({ ...form, pot_size: e.target.value })}
                  placeholder='6"'
                />
              </div>
              <div>
                <label className="label">Soil</label>
                <input
                  className="input"
                  value={form.soil_type}
                  onChange={(e) => setForm({ ...form, soil_type: e.target.value })}
                  placeholder="Aroid mix"
                />
              </div>
            </div>

            <div>
              <label className="label">Health</label>
              <div className="flex flex-wrap gap-2">
                {HEALTH_OPTIONS.map((h) => (
                  <button
                    type="button"
                    key={h}
                    onClick={() => setForm({ ...form, health_status: h })}
                    className="pill border"
                    style={{
                      backgroundColor:
                        form.health_status === h ? HEALTH_META[h].color : "transparent",
                      color: form.health_status === h ? "#04120b" : HEALTH_META[h].color,
                      borderColor: `${HEALTH_META[h].color}55`,
                    }}
                  >
                    {HEALTH_META[h].label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Notes</label>
              <textarea
                className="input min-h-[80px]"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div>
              <label className="label">Photos</label>
              <input type="file" accept="image/*" onChange={onFile} className="text-sm" />
              {uploading && <p className="text-xs text-white/40 mt-1">Uploading…</p>}
              {!!form.image_urls.length && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {form.image_urls.map((u) => (
                    <div key={u} className="relative">
                      <img src={u} className="h-16 w-16 rounded-lg object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage(u)}
                        className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white text-xs"
                        aria-label="Remove photo"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {save.isError && (
              <p className="text-sm text-red-300">Failed to save. Please try again.</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="btn-primary" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
