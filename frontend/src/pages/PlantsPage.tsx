import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { classesApi, imagesApi, instancesApi, type InstanceCreate } from "../api";
import type { HealthStatus } from "../types";
import { HEALTH_META } from "../lib/format";
import PlantCard from "../components/PlantCard";
import IdentifyModal from "../components/IdentifyModal";

const HEALTH_OPTIONS: HealthStatus[] = [
  "thriving",
  "healthy",
  "struggling",
  "critical",
  "dormant",
];

export default function PlantsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState<InstanceCreate>({
    class_id: "",
    nickname: "",
    location: "",
    health_status: "healthy",
    image_urls: [],
  });

  const { data: classes = [] } = useQuery({ queryKey: ["classes"], queryFn: classesApi.list });
  const { data: plants = [], isLoading } = useQuery({
    queryKey: ["instances"],
    queryFn: () => instancesApi.list(),
  });

  const create = useMutation({
    mutationFn: (payload: InstanceCreate) => instancesApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      setForm({ class_id: "", nickname: "", location: "", health_status: "healthy", image_urls: [] });
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return plants.filter(
      (p) =>
        !q ||
        p.nickname?.toLowerCase().includes(q) ||
        p.location?.toLowerCase().includes(q) ||
        p.plant_class?.common_name.toLowerCase().includes(q)
    );
  }, [plants, search]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await imagesApi.upload(file);
      setForm((f) => ({ ...f, image_urls: [...(f.image_urls ?? []), url] }));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">My Plants</h1>
          <p className="text-white/50">{plants.length} living specimens.</p>
        </div>
        <div className="flex gap-2">
          <input
            className="input sm:w-64"
            placeholder="Search plants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="btn-ghost whitespace-nowrap"
            onClick={() => setIdentifyOpen(true)}
          >
            📷 Identify first
          </button>
          <button
            className="btn-primary whitespace-nowrap"
            onClick={() => setOpen(true)}
            disabled={!classes.length}
            title={!classes.length ? "Create a species first" : ""}
          >
            + Add Plant
          </button>
        </div>
      </div>

      {!classes.length && (
        <div className="glass p-6 text-center text-white/60">
          Add a species in the <strong>Species</strong> tab before creating plants,
          or tap <strong>Identify first</strong> to snap a photo and add one automatically.
        </div>
      )}

      {isLoading && <p className="text-white/40">Loading…</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filtered.map((p, i) => (
          <PlantCard key={p.id} plant={p} index={i} />
        ))}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.form
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(form);
              }}
              className="glass w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto no-scrollbar"
            >
              <h2 className="font-display text-2xl font-bold">Add a plant</h2>

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
                <label className="label">Photo</label>
                <input type="file" accept="image/*" onChange={onFile} className="text-sm" />
                {uploading && <p className="text-xs text-white/40 mt-1">Uploading…</p>}
                {!!form.image_urls?.length && (
                  <div className="mt-2 flex gap-2">
                    {form.image_urls.map((u) => (
                      <img key={u} src={u} className="h-16 w-16 rounded-lg object-cover" />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={create.isPending}>
                  {create.isPending ? "Saving…" : "Add plant"}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      <IdentifyModal
        classes={classes}
        open={identifyOpen}
        onClose={() => setIdentifyOpen(false)}
        onUse={({ classId, imageUrls }) => {
          setForm({
            class_id: classId,
            nickname: "",
            location: "",
            health_status: "healthy",
            image_urls: imageUrls,
          });
          setIdentifyOpen(false);
          setOpen(true);
        }}
      />
    </div>
  );
}
