import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { gardensApi } from "../api";
import { useTenant } from "../tenant/TenantContext";
import PropertyWizard from "./wizard/PropertyWizard";

export default function TenantSwitcher() {
  const {
    properties,
    property,
    isOwner,
    setPropertyId,
    gardens,
    garden,
    setGardenId,
    refresh,
  } = useTenant();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [addingGarden, setAddingGarden] = useState(false);
  const [gardenName, setGardenName] = useState("");
  const [gardenDescription, setGardenDescription] = useState("");
  const [gardenSceneFile, setGardenSceneFile] = useState<File | null>(null);
  const [gardenError, setGardenError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const propertyId = property?.id ?? null;

  const createGarden = useMutation({
    mutationFn: async () => {
      if (!propertyId) {
        throw new Error("No active property selected");
      }
      return gardensApi.create(propertyId, {
        name: gardenName.trim(),
        description: gardenDescription.trim() || undefined,
      });
    },
    onSuccess: async (created) => {
      if (gardenSceneFile && propertyId) {
        try {
          await gardensApi.uploadScene(propertyId, created.id, gardenSceneFile);
        } catch (error) {
          const detail =
            (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
            "Garden created, but the Polycam scene upload failed.";
          setGardenError(detail);
        }
      }

      await refresh();
      setGardenId(created.id);
      setGardenName("");
      setGardenDescription("");
      setGardenSceneFile(null);
      setAddingGarden(false);
      setOpen(false);
      navigate(`/gardens/${created.id}`);
    },
    onError: (error: unknown) => {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Could not create garden.";
      setGardenError(detail);
    },
  });

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!property) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 transition-colors max-w-[60vw]"
        title="Switch property or garden"
      >
        <span className="text-base">🏡</span>
        <span className="min-w-0 text-left leading-tight">
          <span className="block truncate text-sm font-semibold">{property.name}</span>
          <span className="block truncate text-[11px] text-white/50">
            {garden ? `🌿 ${garden.name}` : "No gardens yet"}
          </span>
        </span>
        <span className="text-white/40 text-xs">▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 mt-2 w-72 p-3 z-40 max-h-[70vh] overflow-y-auto no-scrollbar rounded-3xl border border-canopy-400/25 bg-[#071a12]/95 backdrop-blur-xl shadow-2xl"
          >
            <div className="text-[11px] uppercase tracking-wider text-canopy-300/70 px-2 pb-1">
              Properties
            </div>
            <div className="space-y-1">
              {properties.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setPropertyId(p.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors ${
                    p.id === property.id
                      ? "bg-canopy-500/20 text-canopy-100"
                      : "hover:bg-white/10 text-white/80"
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-white/40">
                    {p.role}
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                setWizard(true);
                setOpen(false);
              }}
              className="w-full text-left rounded-xl px-3 py-2 text-sm text-canopy-300 hover:bg-white/10 mt-1"
            >
              + New property
            </button>

            <div className="my-2 h-px bg-white/10" />
            <div className="text-[11px] uppercase tracking-wider text-canopy-300/70 px-2 pb-1">
              Gardens
            </div>
            {gardens.length > 0 ? (
              <div className="space-y-1">
                {gardens.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      setGardenId(g.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                      g.id === garden?.id
                        ? "bg-canopy-500/20 text-canopy-100"
                        : "hover:bg-white/10 text-white/80"
                    }`}
                  >
                    <span>🌿</span>
                    <span className="truncate">{g.name}</span>
                    {g.is_home && (
                      <span className="ml-auto text-[10px] text-white/40">home</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-2 text-xs text-white/45">No gardens yet.</p>
            )}

            {isOwner && (
              <div className="mt-2 space-y-2">
                {garden && (
                  <button
                    onClick={() => {
                      navigate(`/gardens/${garden.id}`);
                      setOpen(false);
                    }}
                    className="w-full text-left rounded-xl px-3 py-2 text-sm text-canopy-300 hover:bg-white/10"
                  >
                    Edit garden &amp; scene
                  </button>
                )}
                {!addingGarden ? (
                  <button
                    onClick={() => {
                      setAddingGarden(true);
                      setGardenError(null);
                    }}
                    className="w-full text-left rounded-xl px-3 py-2 text-sm text-canopy-300 hover:bg-white/10"
                  >
                    + New garden
                  </button>
                ) : (
                  <form
                    className="space-y-2 px-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (gardenName.trim()) {
                        createGarden.mutate();
                      }
                    }}
                  >
                    <input
                      autoFocus
                      className="input"
                      placeholder="Garden name"
                      value={gardenName}
                      onChange={(e) => setGardenName(e.target.value)}
                    />
                    <textarea
                      className="input min-h-[84px]"
                      placeholder="Description (optional)"
                      value={gardenDescription}
                      onChange={(e) => setGardenDescription(e.target.value)}
                    />
                    <div className="space-y-1">
                      <label className="block text-xs text-white/55">
                        Optional Polycam scene file
                      </label>
                      <input
                        type="file"
                        accept=".glb,.fbx,.obj,.stl,.dae"
                        className="block w-full text-xs text-white/70"
                        onChange={(e) => setGardenSceneFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                    {gardenError && <p className="text-xs text-red-300">{gardenError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-ghost text-sm py-1.5"
                        onClick={() => {
                          setAddingGarden(false);
                          setGardenName("");
                          setGardenDescription("");
                          setGardenSceneFile(null);
                          setGardenError(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-primary text-sm py-1.5 flex-1"
                        disabled={!gardenName.trim() || createGarden.isPending}
                      >
                        {createGarden.isPending ? "Creating…" : "Create"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {wizard && (
        <PropertyWizard
          isFirst={false}
          onClose={() => setWizard(false)}
          onCreated={async (p) => {
            await refresh();
            setPropertyId(p.id);
            setWizard(false);
          }}
        />
      )}
    </div>
  );
}
