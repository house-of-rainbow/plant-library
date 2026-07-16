import { useEffect, useState } from "react";

/**
 * Real mobile browsers are less reliable with full-screen WebGL backgrounds
 * than desktop emulation. Disable the ambient three.js scenes on coarse-pointer
 * or reduced-motion devices and fall back to static gradients instead.
 */
export function useSceneEffectsEnabled(): boolean {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const coarse = window.matchMedia("(pointer: coarse)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const update = () => {
      setEnabled(!(coarse.matches || reducedMotion.matches));
    };

    update();

    coarse.addEventListener("change", update);
    reducedMotion.addEventListener("change", update);
    return () => {
      coarse.removeEventListener("change", update);
      reducedMotion.removeEventListener("change", update);
    };
  }, []);

  return enabled;
}