import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTenant } from "../tenant/TenantContext";
import PropertyWizard from "./wizard/PropertyWizard";

export default function TenantSwitcher() {
  const {
    properties,
    property,
    setPropertyId,
    gardens,
    garden,
    setGardenId,
    refresh,
  } = useTenant();
  const [open, setOpen] = useState(false);
  const [wizard, setWizard] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
            className="absolute left-0 mt-2 w-72 glass p-3 z-40 max-h-[70vh] overflow-y-auto no-scrollbar"
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

            {gardens.length > 0 && (
              <>
                <div className="my-2 h-px bg-white/10" />
                <div className="text-[11px] uppercase tracking-wider text-canopy-300/70 px-2 pb-1">
                  Gardens
                </div>
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
              </>
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
