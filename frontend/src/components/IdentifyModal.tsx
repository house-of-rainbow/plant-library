import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  classesApi,
  identifyApi,
  imagesApi,
  type IdentifyCandidate,
  type IdentifyStepStatus,
} from "../api";
import type { PlantClass } from "../types";

const MAX_PHOTOS = 5;

type StepKey = "plantnet" | "openai" | "consolidate" | "toxicity" | "enrich";
const STEPS: { key: StepKey; label: string }[] = [
  { key: "plantnet", label: "Pl@ntNet" },
  { key: "openai", label: "GPT vision" },
  { key: "consolidate", label: "Consolidating" },
  { key: "toxicity", label: "Pet toxicity (ASPCA)" },
  { key: "enrich", label: "Final enrichment" },
];

type StepState = Record<StepKey, { status?: IdentifyStepStatus; count?: number }>;
const EMPTY_STEPS = {} as StepState;

function confidenceColor(score: number): string {
  if (score >= 0.5) return "#34d399";
  if (score >= 0.2) return "#fbbf24";
  return "#f87171";
}

function normalize(s?: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

const TOX_BADGE: Record<string, { text: string; cls: string }> = {
  danger: { text: "☠️ Severe pet risk", cls: "bg-red-500/25 text-red-200" },
  toxic: { text: "⚠️ Toxic to pets", cls: "bg-amber-500/20 text-amber-200" },
  caution: { text: "⚠️ Use caution", cls: "bg-amber-500/20 text-amber-200" },
  safe: { text: "✅ Pet-safe (ASPCA)", cls: "bg-canopy-500/20 text-canopy-200" },
  unknown: { text: "❓ Toxicity unknown", cls: "bg-white/10 text-white/50" },
};

function EngineList({
  title,
  items,
  onImage,
}: {
  title: string;
  items: IdentifyCandidate[];
  onImage: (url: string) => void;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-white/40">No candidates.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((c) => {
            const pct = Math.round(c.score * 100);
            return (
              <li key={c.scientific_name + c.score} className="flex items-center gap-2">
                {c.image_url ? (
                  <button
                    type="button"
                    onClick={() => onImage(c.image_url!)}
                    className="shrink-0"
                    aria-label="View image"
                  >
                    <img
                      src={c.image_url}
                      className="h-8 w-8 rounded object-cover hover:ring-2 hover:ring-canopy-400"
                    />
                  </button>
                ) : (
                  <span className="grid h-8 w-8 place-items-center rounded bg-white/5 text-xs shrink-0">
                    🌿
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-white/70">
                  {c.common_name || c.scientific_name_without_author || c.scientific_name}
                </span>
                <span
                  className="text-[11px] font-medium"
                  style={{ color: confidenceColor(c.score) }}
                >
                  {pct}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StepRow({
  label,
  status,
  count,
}: {
  label: string;
  status?: IdentifyStepStatus;
  count?: number;
}) {
  let icon = <span className="h-4 w-4 rounded-full bg-white/15" />;
  let tone = "text-white/40";
  if (status === "running") {
    icon = (
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        className="inline-block text-canopy-300"
      >
        ◌
      </motion.span>
    );
    tone = "text-white/80";
  } else if (status === "done") {
    icon = <span className="text-canopy-300">✓</span>;
    tone = "text-white/80";
  } else if (status === "error") {
    icon = <span className="text-amber-300">!</span>;
    tone = "text-amber-300/80";
  } else if (status === "skipped") {
    icon = <span className="text-white/30">–</span>;
    tone = "text-white/30";
  }
  return (
    <div className={`flex items-center gap-3 text-sm ${tone}`}>
      <span className="grid h-5 w-5 place-items-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {typeof count === "number" && status === "done" && (
        <span className="text-xs text-white/40">
          {count} match{count === 1 ? "" : "es"}
        </span>
      )}
      {status === "error" && <span className="text-xs">unavailable</span>}
      {status === "skipped" && <span className="text-xs">not configured</span>}
    </div>
  );
}

/**
 * Camera-first identification. Snap up to 5 photos, then the backend queries
 * Pl@ntNet and GPT in parallel and asks GPT to consolidate both — progress is
 * streamed and shown as steps. Pick a candidate to use (creating the species if
 * it doesn't exist yet).
 */
export default function IdentifyModal({
  classes,
  propertyId,
  open,
  onClose,
  onUse,
}: {
  classes: PlantClass[];
  propertyId: string;
  open: boolean;
  onClose: () => void;
  onUse: (result: { classId: string; imageUrls: string[]; promptContext: string }) => void;
}) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [promptContext, setPromptContext] = useState("");
  const [steps, setSteps] = useState<StepState>(EMPTY_STEPS);
  const [candidates, setCandidates] = useState<IdentifyCandidate[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engineResults, setEngineResults] = useState<{
    plantnet: IdentifyCandidate[];
    openai: IdentifyCandidate[];
  }>({ plantnet: [], openai: [] });
  const [showDetails, setShowDetails] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  function reset() {
    setFiles([]);
    setRunning(false);
    setPromptContext("");
    setSteps(EMPTY_STEPS);
    setCandidates(null);
    setSummary(null);
    setError(null);
    setEngineResults({ plantnet: [], openai: [] });
    setShowDetails(false);
    setLightbox(null);
  }

  function close() {
    reset();
    onClose();
  }

  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;
    setFiles((prev) => [...prev, ...selected].slice(0, MAX_PHOTOS));
    setCandidates(null);
    e.target.value = "";
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setCandidates(null);
  }

  async function runIdentify() {
    setRunning(true);
    setError(null);
    setCandidates(null);
    setSummary(null);
    setSteps({
      plantnet: { status: "running" },
      openai: { status: "running" },
      consolidate: {},
      toxicity: {},
    } as StepState);
    setEngineResults({ plantnet: [], openai: [] });
    setShowDetails(false);
    try {
      await identifyApi.identifyStream(files, promptContext, (e) => {
        if (e.step === "complete") {
          setCandidates(e.candidates ?? []);
          setSummary(e.summary ?? null);
        } else if (
          e.step === "plantnet" ||
          e.step === "openai" ||
          e.step === "consolidate" ||
          e.step === "toxicity" ||
          e.step === "enrich"
        ) {
          const key = e.step as StepKey;
          setSteps((prev) => ({ ...prev, [key]: { status: e.status, count: e.count } }));
          if ((e.step === "plantnet" || e.step === "openai") && e.candidates) {
            const engine = e.step;
            setEngineResults((prev) => ({ ...prev, [engine]: e.candidates ?? [] }));
          }
        }
      });
    } catch {
      setError("Identification failed. Check the photos and try again.");
    } finally {
      setRunning(false);
    }
  }

  function matchClass(c: IdentifyCandidate): PlantClass | undefined {
    const binomial = normalize(c.scientific_name_without_author || c.scientific_name);
    return classes.find((cls) => {
      const sci = normalize(cls.scientific_name);
      return sci && (sci === binomial || sci.startsWith(binomial) || binomial.startsWith(sci));
    });
  }

  const use = useMutation({
    mutationFn: async (candidate: IdentifyCandidate) => {
      const imageUrls = await Promise.all(files.map((f) => imagesApi.upload(f)));
      let cls = matchClass(candidate);
      if (!cls) {
        const tox = candidate.pet_toxicity;
        const careNotes = [
          candidate.care_notes,
          tox && tox.matched ? tox.summary : "",
          tox?.toxic_principles ? `Toxic principles: ${tox.toxic_principles}` : "",
          tox?.clinical_signs ? `Clinical signs: ${tox.clinical_signs}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const referenceUrls = [candidate.reference_url, tox?.source_url]
          .filter((value): value is string => !!value)
          .filter((value, index, list) => list.indexOf(value) === index);
        cls = await classesApi.create(propertyId, {
          common_name:
            candidate.common_name ||
            candidate.scientific_name_without_author ||
            candidate.scientific_name,
          scientific_name:
            candidate.scientific_name_without_author || candidate.scientific_name,
          family: candidate.family || undefined,
          genus: candidate.genus || undefined,
          description: candidate.description || undefined,
          reference_urls: referenceUrls,
          hero_image_url: candidate.image_url || undefined,
          care_defaults: {
            watering_interval_days: candidate.watering_interval_days ?? undefined,
            watering_notes: candidate.watering_notes || undefined,
            sunlight: candidate.sunlight || undefined,
            light_notes: candidate.light_notes || undefined,
            fertilizing_interval_days: candidate.fertilizing_interval_days ?? undefined,
            fertilizer_type: candidate.fertilizer_type || undefined,
            fertilizer_notes: candidate.fertilizer_notes || undefined,
            repotting_interval_months: candidate.repotting_interval_months ?? undefined,
            soil_type: candidate.soil_type || undefined,
            pot_size: candidate.pot_size || undefined,
            hardiness_zone: candidate.hardiness_zone || undefined,
            mature_size: candidate.mature_size || undefined,
            pruning_notes: candidate.pruning_notes || undefined,
            propagation_notes: candidate.propagation_notes || undefined,
            pests_notes: candidate.pests_notes || undefined,
            toxic_to_pets: tox?.toxic_to_pets ?? candidate.toxic_to_pets ?? undefined,
            care_notes: careNotes || undefined,
          },
        } as Partial<PlantClass>);
        qc.invalidateQueries({ queryKey: ["classes"] });
      }
      return { classId: cls.id, imageUrls, promptContext: promptContext.trim() };
    },
    onSuccess: (r) => {
      onUse(r);
      close();
    },
  });

  const showSteps = running || candidates !== null;

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
                Snap up to {MAX_PHOTOS} photos — we cross-check Pl@ntNet and AI vision.
              </p>
            </div>

            <div>
              <label className="label">Helpful context for AI vision (optional)</label>
              <textarea
                className="input min-h-[84px]"
                value={promptContext}
                onChange={(e) => setPromptContext(e.target.value)}
                placeholder="Example: I bought this as a Red Banana at Burien Nursery, but the label might be wrong."
              />
              <p className="mt-1 text-xs text-white/45">
                Added to GPT Vision and consolidation only. Useful when you already have a likely name, source, or note about the plant.
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
              disabled={!files.length || running}
              onClick={runIdentify}
            >
              {running ? "Identifying…" : "Identify"}
            </button>

            {error && <p className="text-sm text-red-300">{error}</p>}

            {/* Progress stepper */}
            {showSteps && (
              <div className="glass-soft p-4 space-y-2.5">
                {STEPS.map((s) => (
                  <StepRow
                    key={s.key}
                    label={s.label}
                    status={steps[s.key]?.status}
                    count={steps[s.key]?.count}
                  />
                ))}
              </div>
            )}

            {/* Results */}
            {candidates !== null && (
              <div className="space-y-2">
                {summary && <p className="text-xs text-white/60 italic">“{summary}”</p>}
                {candidates.length === 0 && (
                  <p className="text-sm text-white/60">
                    No confident match. Try clearer photos of leaves or flowers.
                  </p>
                )}
                {candidates.map((c) => {
                  const existing = matchClass(c);
                  const pct = Math.round(c.score * 100);
                  return (
                    <div
                      key={c.scientific_name + c.score}
                      className="glass-soft p-3 flex items-center gap-3"
                    >
                      {c.image_url ? (
                        <button
                          type="button"
                          onClick={() => setLightbox(c.image_url!)}
                          className="shrink-0"
                          aria-label="View image"
                        >
                          <img
                            src={c.image_url}
                            className="h-12 w-12 rounded-lg object-cover hover:ring-2 hover:ring-canopy-400"
                          />
                        </button>
                      ) : (
                        <div className="grid h-12 w-12 place-items-center rounded-lg bg-white/5 shrink-0">
                          🌿
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">
                            {c.common_name ||
                              c.scientific_name_without_author ||
                              c.scientific_name}
                          </span>
                          {c.agreed_by_both && (
                            <span className="pill bg-canopy-500/20 text-canopy-200 text-[10px] py-0">
                              ✓ both
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs italic text-white/50">
                          {c.scientific_name_without_author || c.scientific_name}
                          {c.family ? ` · ${c.family}` : ""}
                        </div>
                        {c.pet_toxicity && (
                          <div
                            className={`pill mt-1 text-[10px] py-0 ${
                              (TOX_BADGE[c.pet_toxicity.label_level] ?? TOX_BADGE.unknown).cls
                            }`}
                            title={c.pet_toxicity.summary || ""}
                          >
                            {(TOX_BADGE[c.pet_toxicity.label_level] ?? TOX_BADGE.unknown).text}
                          </div>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: confidenceColor(c.score),
                              }}
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

                {(engineResults.plantnet.length > 0 || engineResults.openai.length > 0) && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowDetails((v) => !v)}
                      className="text-xs text-white/50 hover:text-white/80"
                    >
                      {showDetails ? "▾ Hide" : "▸ See"} what each engine said
                    </button>
                    <AnimatePresence initial={false}>
                      {showDetails && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3">
                            <EngineList
                              title="Pl@ntNet"
                              items={engineResults.plantnet}
                              onImage={setLightbox}
                            />
                            <EngineList
                              title="GPT vision"
                              items={engineResults.openai}
                              onImage={setLightbox}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button className="btn-ghost" onClick={close}>
                Cancel
              </button>
            </div>
          </motion.div>

          {/* Image lightbox */}
          <AnimatePresence>
            {lightbox && (
              <motion.div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox(null);
                }}
              >
                <motion.img
                  src={lightbox}
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0.9 }}
                  className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain"
                />
                <button
                  className="absolute top-5 right-5 text-2xl text-white/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightbox(null);
                  }}
                  aria-label="Close"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
