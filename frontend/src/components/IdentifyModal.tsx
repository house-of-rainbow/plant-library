import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  classesApi,
  identifyApi,
  imagesApi,
  type IdentifyCandidate,
  type IdentifyResponse,
} from "../api";
import type { PlantClass } from "../types";

const MAX_PHOTOS = 5;

function confidenceColor(score: number): string {
  if (score >= 0.5) return "#34d399";
  if (score >= 0.2) return "#fbbf24";
  return "#f87171";
}

function normalize(s?: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Camera-first identification flow. The user snaps up to 5 photos, we call the
 * Pl@ntNet-backed /api/identify, then they pick a candidate. If no matching
 * species exists in the library we create it on the fly. The captured photos
 * are uploaded and handed back to prefill the new plant.
 */
export default function IdentifyModal({
  classes,
  open,
  onClose,
  onUse,
}: {
  classes: PlantClass[];
  open: boolean;
  onClose: () => void;
  onUse: (result: { classId: string; imageUrls: string[] }) => void;
}) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<IdentifyResponse | null>(null);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  function reset() {
    setFiles([]);
    setResult(null);
  }

  function close() {
    reset();
    onClose();
  }

  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;
    setFiles((prev) => [...prev, ...selected].slice(0, MAX_PHOTOS));
    setResult(null);
    e.target.value = "";
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setResult(null);
  }

  const identify = useMutation({
    mutationFn: () => identifyApi.identify(files),
    onSuccess: (data) => setResult(data),
  });

  // Find an existing library species that matches a candidate (by binomial).
  function matchClass(c: IdentifyCandidate): PlantClass | undefined {
    const binomial = normalize(c.scientific_name_without_author || c.scientific_name);
    return classes.find((cls) => {
      const sci = normalize(cls.scientific_name);
      return sci && (sci === binomial || sci.startsWith(binomial) || binomial.startsWith(sci));
    });
  }

  const use = useMutation({
    mutationFn: async (candidate: IdentifyCandidate) => {
      // Upload the captured photos so they can be attached to the plant.
      const imageUrls = await Promise.all(files.map((f) => imagesApi.upload(f)));

      let cls = matchClass(candidate);
      if (!cls) {
        cls = await classesApi.create({
          common_name:
            candidate.common_name ||
            candidate.scientific_name_without_author ||
            candidate.scientific_name,
          scientific_name:
            candidate.scientific_name_without_author || candidate.scientific_name,
          family: candidate.family || undefined,
          genus: candidate.genus || undefined,
          care_defaults: {},
        } as Partial<PlantClass>);
        qc.invalidateQueries({ queryKey: ["classes"] });
      }
      return { classId: cls.id, imageUrls };
    },
    onSuccess: (r) => {
      onUse(r);
      close();
    },
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="glass w-full max-w-lg p-6 space-y-4 max-h-[88vh] overflow-y-auto no-scrollbar"
          >
            <div>
              <h2 className="font-display text-2xl font-bold">📷 Identify a plant</h2>
              <p className="text-sm text-white/50">
                Snap up to {MAX_PHOTOS} photos — leaves, flowers or fruit work best.
              </p>
            </div>

            {/* Photo tray */}
            <div className="flex flex-wrap gap-2">
              {previews.map((src, i) => (
                <div key={src} className="relative">
                  <img src={src} className="h-20 w-20 rounded-xl object-cover" />
                  <button
                    onClick={() => removeFile(i)}
                    className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white text-xs"
                    aria-label="Remove photo"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {files.length < MAX_PHOTOS && (
                <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-xl border border-dashed border-white/20 text-2xl text-white/50 hover:border-canopy-400 hover:text-canopy-300">
                  +
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="hidden"
                    onChange={addFiles}
                  />
                </label>
              )}
            </div>

            <button
              className="btn-primary w-full"
              disabled={!files.length || identify.isPending}
              onClick={() => identify.mutate()}
            >
              {identify.isPending ? "Identifying…" : "Identify"}
            </button>

            {identify.isError && (
              <p className="text-sm text-red-300">
                Identification failed. Check the photos and try again.
              </p>
            )}

            {/* Results */}
            {result && (
              <div className="space-y-2">
                {result.candidates.length === 0 && (
                  <p className="text-sm text-white/60">
                    No confident match. Try clearer photos of leaves or flowers.
                  </p>
                )}
                {result.candidates.map((c) => {
                  const existing = matchClass(c);
                  const pct = Math.round(c.score * 100);
                  return (
                    <div
                      key={c.scientific_name + c.score}
                      className="glass-soft p-3 flex items-center gap-3"
                    >
                      {c.image_url ? (
                        <img
                          src={c.image_url}
                          className="h-12 w-12 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="grid h-12 w-12 place-items-center rounded-lg bg-white/5 shrink-0">
                          🌿
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">
                          {c.common_name || c.scientific_name_without_author || c.scientific_name}
                        </div>
                        <div className="truncate text-xs italic text-white/50">
                          {c.scientific_name_without_author || c.scientific_name}
                          {c.family ? ` · ${c.family}` : ""}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, backgroundColor: confidenceColor(c.score) }}
                            />
                          </div>
                          <span
                            className="text-[11px] font-medium"
                            style={{ color: confidenceColor(c.score) }}
                          >
                            {pct}%
                          </span>
                        </div>
                      </div>
                      <button
                        className="btn-ghost text-xs py-1.5 shrink-0 whitespace-nowrap"
                        disabled={use.isPending}
                        onClick={() => use.mutate(c)}
                      >
                        {existing ? "Use" : "Add & use"}
                      </button>
                    </div>
                  );
                })}
                {use.isPending && (
                  <p className="text-xs text-white/40">Saving species & photos…</p>
                )}
                {use.isError && (
                  <p className="text-sm text-red-300">Couldn't save. Please retry.</p>
                )}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button className="btn-ghost" onClick={close}>
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
