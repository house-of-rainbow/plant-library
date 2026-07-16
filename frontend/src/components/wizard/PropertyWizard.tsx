import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { propertiesApi } from "../../api";
import { useSceneEffectsEnabled } from "../../lib/effects";
import type { Property } from "../../types";
import WizardScene from "../../three/WizardScene";

interface Props {
  /** Whether this is the user's very first property (adds the Home garden step). */
  isFirst: boolean;
  /** Allow dismissing without creating (hidden for the mandatory first run). */
  onClose?: () => void;
  onCreated: (property: Property) => void;
}

type StepId = "welcome" | "property" | "garden" | "finish";

export default function PropertyWizard({ isFirst, onClose, onCreated }: Props) {
  const effectsEnabled = useSceneEffectsEnabled();
  const steps: StepId[] = useMemo(
    () => (isFirst ? ["welcome", "property", "garden", "finish"] : ["welcome", "property", "finish"]),
    [isFirst]
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [homeGarden, setHomeGarden] = useState("Home");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = steps[stepIndex];
  const progress = stepIndex / (steps.length - 1);

  const canAdvance = step === "property" ? name.trim().length > 0 : true;

  function next() {
    setError(null);
    if (stepIndex < steps.length - 1) setStepIndex((i) => i + 1);
  }
  function back() {
    setError(null);
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }

  async function create() {
    setSubmitting(true);
    setError(null);
    try {
      const property = await propertiesApi.create({
        name: name.trim(),
        address: address.trim() || undefined,
        home_garden_name: isFirst ? homeGarden.trim() || "Home" : undefined,
      });
      onCreated(property);
    } catch (e) {
      setError("Something went wrong creating your space. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#04120b]">
      {/* Immersive background on desktop; static fallback on real mobile. */}
      {effectsEnabled ? (
        <div className="absolute inset-0">
          <WizardScene progress={0.15 + progress * 0.85} />
        </div>
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_20%_-10%,rgba(32,161,94,0.22),transparent_60%),radial-gradient(900px_600px_at_100%_0%,rgba(236,72,153,0.12),transparent_55%),linear-gradient(180deg,#062014_0%,#04120b_100%)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#04120b] via-transparent to-[#04120b]/40 pointer-events-none" />

      {/* Progress dots */}
      <div className="absolute top-6 inset-x-0 flex justify-center gap-2 z-10">
        {steps.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i <= stepIndex ? "w-8 bg-canopy-400" : "w-4 bg-white/20"
            }`}
          />
        ))}
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-5 right-5 z-10 text-white/50 hover:text-white text-sm"
        >
          Skip for now ✕
        </button>
      )}

      {/* Step content */}
      <div className="relative z-10 h-full flex items-end sm:items-center justify-center p-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="glass w-full max-w-md p-7 space-y-5"
          >
            {step === "welcome" && (
              <div className="space-y-3 text-center">
                <div className="text-5xl">🌱</div>
                <h1 className="font-display text-3xl font-bold">
                  Let's plant your space
                </h1>
                <p className="text-white/60">
                  {isFirst
                    ? "Welcome! A property holds your gardens, and gardens hold your plants. Let's grow your very first one."
                    : "Create a new property to organize another set of gardens and plants."}
                </p>
                <button className="btn-primary w-full mt-2" onClick={next}>
                  Begin 🌿
                </button>
              </div>
            )}

            {step === "property" && (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="text-4xl mb-1">🏡</div>
                  <h2 className="font-display text-2xl font-bold">Name your property</h2>
                  <p className="text-white/50 text-sm">
                    This is the top of your collection — a home, an office, a plot.
                  </p>
                </div>
                <div>
                  <label className="label">Property name *</label>
                  <input
                    autoFocus
                    className="input"
                    value={name}
                    placeholder="e.g. Burien Station"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canAdvance) next();
                    }}
                  />
                </div>
                <div>
                  <label className="label">Address (optional)</label>
                  <input
                    className="input"
                    value={address}
                    placeholder="123 Fern Lane"
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button className="btn-ghost" onClick={back}>
                    Back
                  </button>
                  <button
                    className="btn-primary flex-1"
                    disabled={!canAdvance}
                    onClick={next}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {step === "garden" && (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="text-4xl mb-1">🌿</div>
                  <h2 className="font-display text-2xl font-bold">
                    Create your Home garden
                  </h2>
                  <p className="text-white/50 text-sm">
                    Every property starts with one garden. You can add more later.
                  </p>
                </div>
                <div>
                  <label className="label">Garden name</label>
                  <input
                    autoFocus
                    className="input"
                    value={homeGarden}
                    placeholder="Home"
                    onChange={(e) => setHomeGarden(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") next();
                    }}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button className="btn-ghost" onClick={back}>
                    Back
                  </button>
                  <button className="btn-primary flex-1" onClick={next}>
                    Continue
                  </button>
                </div>
              </div>
            )}

            {step === "finish" && (
              <div className="space-y-4 text-center">
                <motion.div
                  className="text-5xl"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  ✨
                </motion.div>
                <h2 className="font-display text-2xl font-bold">Ready to grow</h2>
                <div className="glass-soft p-4 text-left space-y-1 text-sm">
                  <div>
                    <span className="text-white/50">Property:</span>{" "}
                    <span className="font-semibold">{name || "—"}</span>
                  </div>
                  {address.trim() && (
                    <div>
                      <span className="text-white/50">Address:</span> {address}
                    </div>
                  )}
                  {isFirst && (
                    <div>
                      <span className="text-white/50">Home garden:</span>{" "}
                      {homeGarden.trim() || "Home"}
                    </div>
                  )}
                </div>
                {error && <p className="text-red-300 text-sm">{error}</p>}
                <div className="flex gap-2">
                  <button className="btn-ghost" onClick={back} disabled={submitting}>
                    Back
                  </button>
                  <button
                    className="btn-primary flex-1"
                    onClick={create}
                    disabled={submitting}
                  >
                    {submitting ? "Planting…" : "Plant it 🌱"}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
