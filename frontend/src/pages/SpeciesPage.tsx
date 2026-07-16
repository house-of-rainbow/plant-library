import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { classesApi } from "../api";
import type { PlantClass, SunlightLevel } from "../types";
import { SUNLIGHT_META } from "../lib/format";
import { useTenant } from "../tenant/TenantContext";

const SUNLIGHT_OPTIONS: SunlightLevel[] = ["low", "medium", "bright_indirect", "direct"];

interface FormState {
  common_name: string;
  scientific_name: string;
  family: string;
  genus: string;
  description: string;
  hero_image_url: string;
  watering_interval_days: string;
  watering_notes: string;
  fertilizing_interval_days: string;
  fertilizer_type: string;
  fertilizer_notes: string;
  repotting_interval_months: string;
  sunlight: SunlightLevel | "";
  light_notes: string;
  soil_type: string;
  pot_size: string;
  hardiness_zone: string;
  mature_size: string;
  pruning_notes: string;
  propagation_notes: string;
  pests_notes: string;
  care_notes: string;
  toxic_to_pets: boolean;
}

const EMPTY: FormState = {
  common_name: "",
  scientific_name: "",
  family: "",
  genus: "",
  description: "",
  hero_image_url: "",
  watering_interval_days: "",
  watering_notes: "",
  fertilizing_interval_days: "",
  fertilizer_type: "",
  fertilizer_notes: "",
  repotting_interval_months: "",
  sunlight: "",
  light_notes: "",
  soil_type: "",
  pot_size: "",
  hardiness_zone: "",
  mature_size: "",
  pruning_notes: "",
  propagation_notes: "",
  pests_notes: "",
  care_notes: "",
  toxic_to_pets: false,
};

function toPayload(f: FormState): Partial<PlantClass> {
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const str = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    common_name: f.common_name.trim(),
    scientific_name: str(f.scientific_name),
    family: str(f.family),
    genus: str(f.genus),
    description: str(f.description),
    hero_image_url: str(f.hero_image_url),
    care_defaults: {
      watering_interval_days: num(f.watering_interval_days),
      watering_notes: str(f.watering_notes),
      fertilizing_interval_days: num(f.fertilizing_interval_days),
      fertilizer_type: str(f.fertilizer_type),
      fertilizer_notes: str(f.fertilizer_notes),
      repotting_interval_months: num(f.repotting_interval_months),
      sunlight: f.sunlight || null,
      light_notes: str(f.light_notes),
      soil_type: str(f.soil_type),
      pot_size: str(f.pot_size),
      hardiness_zone: str(f.hardiness_zone),
      mature_size: str(f.mature_size),
      pruning_notes: str(f.pruning_notes),
      propagation_notes: str(f.propagation_notes),
      pests_notes: str(f.pests_notes),
      care_notes: str(f.care_notes),
      toxic_to_pets: f.toxic_to_pets,
    },
  };
}

export default function SpeciesPage() {
  const qc = useQueryClient();
  const { propertyId } = useTenant();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlantClass | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const { data: classes = [], isLoading } = useQuery({
    queryKey: ["classes", propertyId],
    queryFn: () => classesApi.list(propertyId!),
    enabled: !!propertyId,
  });

  const save = useMutation({
    mutationFn: (f: FormState) =>
      editing
        ? classesApi.update(propertyId!, editing.id, toPayload(f))
        : classesApi.create(propertyId!, toPayload(f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes"] });
      closeForm();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => classesApi.remove(propertyId!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["classes"] }),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(c: PlantClass) {
    setEditing(c);
    const d = c.care_defaults;
    setForm({
      common_name: c.common_name,
      scientific_name: c.scientific_name ?? "",
      family: c.family ?? "",
      genus: c.genus ?? "",
      description: c.description ?? "",
      hero_image_url: c.hero_image_url ?? "",
      watering_interval_days: d.watering_interval_days?.toString() ?? "",
      watering_notes: d.watering_notes ?? "",
      fertilizing_interval_days: d.fertilizing_interval_days?.toString() ?? "",
      fertilizer_type: d.fertilizer_type ?? "",
      fertilizer_notes: d.fertilizer_notes ?? "",
      repotting_interval_months: d.repotting_interval_months?.toString() ?? "",
      sunlight: d.sunlight ?? "",
      light_notes: d.light_notes ?? "",
      soil_type: d.soil_type ?? "",
      pot_size: d.pot_size ?? "",
      hardiness_zone: d.hardiness_zone ?? "",
      mature_size: d.mature_size ?? "",
      pruning_notes: d.pruning_notes ?? "",
      propagation_notes: d.propagation_notes ?? "",
      pests_notes: d.pests_notes ?? "",
      care_notes: d.care_notes ?? "",
      toxic_to_pets: !!d.toxic_to_pets,
    });
    setOpen(true);
  }

  function closeForm() {
    setOpen(false);
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Species Library</h1>
          <p className="text-white/50">Care templates every specimen inherits.</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          + New Species
        </button>
      </div>

      {isLoading && <p className="text-white/40">Loading…</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {classes.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="glass p-5"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold">{c.common_name}</h3>
                <p className="text-sm italic text-white/50">{c.scientific_name || "—"}</p>
              </div>
              {c.care_defaults.sunlight && (
                <span className="pill bg-white/5" title={SUNLIGHT_META[c.care_defaults.sunlight].label}>
                  {SUNLIGHT_META[c.care_defaults.sunlight].icon}
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/60">
              {c.care_defaults.watering_interval_days != null && (
                <span className="pill bg-canopy-500/15 text-canopy-200">
                  💧 every {c.care_defaults.watering_interval_days}d
                </span>
              )}
              {c.care_defaults.toxic_to_pets && (
                <span className="pill bg-red-500/15 text-red-300">☠️ pet-toxic</span>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button className="btn-ghost text-sm py-1.5" onClick={() => openEdit(c)}>
                Edit
              </button>
              <button
                className="btn-ghost text-sm py-1.5 text-red-300"
                onClick={() => {
                  if (confirm(`Delete species "${c.common_name}"?`)) remove.mutate(c.id);
                }}
              >
                Delete
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeForm}
          >
            <motion.form
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
              }}
              className="glass w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto no-scrollbar"
            >
              <h2 className="font-display text-2xl font-bold">
                {editing ? "Edit species" : "New species"}
              </h2>

              <div>
                <label className="label">Common name *</label>
                <input
                  className="input"
                  required
                  value={form.common_name}
                  onChange={(e) => setForm({ ...form, common_name: e.target.value })}
                  placeholder="Monstera Deliciosa"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Scientific name</label>
                  <input
                    className="input"
                    value={form.scientific_name}
                    onChange={(e) => setForm({ ...form, scientific_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Family</label>
                  <input
                    className="input"
                    value={form.family}
                    onChange={(e) => setForm({ ...form, family: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Water (days)</label>
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={form.watering_interval_days}
                    onChange={(e) =>
                      setForm({ ...form, watering_interval_days: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">Fertilize (days)</label>
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={form.fertilizing_interval_days}
                    onChange={(e) =>
                      setForm({ ...form, fertilizing_interval_days: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">Repot (months)</label>
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={form.repotting_interval_months}
                    onChange={(e) =>
                      setForm({ ...form, repotting_interval_months: e.target.value })
                    }
                  />
                </div>
              </div>

              <div>
                <label className="label">Sunlight</label>
                <div className="flex flex-wrap gap-2">
                  {SUNLIGHT_OPTIONS.map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => setForm({ ...form, sunlight: s })}
                      className={`pill border ${
                        form.sunlight === s
                          ? "bg-canopy-500 text-canopy-950 border-transparent"
                          : "bg-white/5 border-white/10 text-white/70"
                      }`}
                    >
                      {SUNLIGHT_META[s].icon} {SUNLIGHT_META[s].label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Genus</label>
                  <input
                    className="input"
                    value={form.genus}
                    onChange={(e) => setForm({ ...form, genus: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Hardiness zone</label>
                  <input
                    className="input"
                    value={form.hardiness_zone}
                    onChange={(e) => setForm({ ...form, hardiness_zone: e.target.value })}
                    placeholder="e.g. 10-12"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Soil</label>
                  <input
                    className="input"
                    value={form.soil_type}
                    onChange={(e) => setForm({ ...form, soil_type: e.target.value })}
                    placeholder="Well-draining aroid mix"
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
              </div>

              <div className="pt-1 text-xs uppercase tracking-wider text-canopy-300/70">
                Fertilizer
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Type</label>
                  <input
                    className="input"
                    value={form.fertilizer_type}
                    onChange={(e) => setForm({ ...form, fertilizer_type: e.target.value })}
                    placeholder="Balanced 10-10-10, liquid…"
                  />
                </div>
                <div>
                  <label className="label">Mature size</label>
                  <input
                    className="input"
                    value={form.mature_size}
                    onChange={(e) => setForm({ ...form, mature_size: e.target.value })}
                    placeholder="Up to 3m"
                  />
                </div>
              </div>
              <div>
                <label className="label">Fertilizer notes</label>
                <textarea
                  className="input min-h-[60px]"
                  value={form.fertilizer_notes}
                  onChange={(e) => setForm({ ...form, fertilizer_notes: e.target.value })}
                  placeholder="Feed monthly during spring/summer; dilute to half strength."
                />
              </div>

              <div className="pt-1 text-xs uppercase tracking-wider text-canopy-300/70">
                Care notes
              </div>
              <div>
                <label className="label">Watering notes</label>
                <textarea
                  className="input min-h-[60px]"
                  value={form.watering_notes}
                  onChange={(e) => setForm({ ...form, watering_notes: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Light notes</label>
                <input
                  className="input"
                  value={form.light_notes}
                  onChange={(e) => setForm({ ...form, light_notes: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Pruning notes</label>
                <textarea
                  className="input min-h-[60px]"
                  value={form.pruning_notes}
                  onChange={(e) => setForm({ ...form, pruning_notes: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Propagation notes</label>
                <textarea
                  className="input min-h-[60px]"
                  value={form.propagation_notes}
                  onChange={(e) => setForm({ ...form, propagation_notes: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Pests &amp; treatments</label>
                <textarea
                  className="input min-h-[60px]"
                  value={form.pests_notes}
                  onChange={(e) => setForm({ ...form, pests_notes: e.target.value })}
                />
              </div>
              <div>
                <label className="label">General care notes</label>
                <textarea
                  className="input min-h-[60px]"
                  value={form.care_notes}
                  onChange={(e) => setForm({ ...form, care_notes: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Hero image URL</label>
                <input
                  className="input"
                  value={form.hero_image_url}
                  onChange={(e) => setForm({ ...form, hero_image_url: e.target.value })}
                  placeholder="https://…"
                />
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input min-h-[80px]"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={form.toxic_to_pets}
                  onChange={(e) => setForm({ ...form, toxic_to_pets: e.target.checked })}
                />
                Toxic to pets
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={closeForm}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
