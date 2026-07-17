import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { MeshDistortMaterial, Sparkles } from "@react-three/drei";
import * as THREE from "three";

/**
 * The "identification chamber" — a deliberately over-the-top 3D visualization
 * of the plant-ID pipeline. A distorting neural core sits at the center while
 * each engine step orbits as a glowing satellite firing energy beams inward.
 *
 * Crucially, the whole chamber RECONFIGURES per phase: palette, lighting, fog,
 * camera orientation, and the satellite formation all shift dramatically as the
 * pipeline moves plantnet/openai -> consolidate -> toxicity -> articles ->
 * enrich -> complete. Everything damps smoothly toward the active phase's
 * targets so each step reads as a distinct "scene".
 *
 * Stays on for touch devices (this is the focal experience); only reduced-motion
 * users get the static fallback.
 */

export type IdentifySceneStepStatus = "running" | "done" | "error" | "skipped";

export interface IdentifySceneStep {
  key: string;
  color: string;
  status?: IdentifySceneStepStatus;
}

const ERROR_COLOR = "#f87171";

// ---- Per-phase chamber configuration -------------------------------------

interface PhaseConfig {
  accent: THREE.Color; // core / dominant hue
  accent2: THREE.Color; // secondary (wireframe, gradient target)
  light1: THREE.Color;
  light2: THREE.Color;
  fog: THREE.Color;
  cam: THREE.Vector3; // camera framing / orientation
  radius: number; // satellite ring radius
  vAmpAngle: number; // vertical wobble by angle (ring undulation)
  vAmpIndex: number; // vertical spread by index (helix / stack)
  twist: number; // angular twist across the formation
  tilt: number; // whole-formation X tilt (orientation)
  vortexPull: number; // +inward / -outward, magnitude = speed
  coreSpin: number; // core rotation speed
}

function phase(
  accent: string,
  accent2: string,
  light1: string,
  light2: string,
  fog: string,
  cam: [number, number, number],
  layout: {
    radius: number;
    vAmpAngle: number;
    vAmpIndex: number;
    twist: number;
    tilt: number;
    vortexPull: number;
    coreSpin: number;
  }
): PhaseConfig {
  return {
    accent: new THREE.Color(accent),
    accent2: new THREE.Color(accent2),
    light1: new THREE.Color(light1),
    light2: new THREE.Color(light2),
    fog: new THREE.Color(fog),
    cam: new THREE.Vector3(...cam),
    ...layout,
  };
}

const PHASES: Record<string, PhaseConfig> = {
  // Idle / awaiting input — calm cyan, head-on, gently undulating ring.
  start: phase("#38bdf8", "#22d3ee", "#7dd8a3", "#ec4899", "#04120b", [0, 1.6, 6], {
    radius: 2.8,
    vAmpAngle: 0.45,
    vAmpIndex: 0,
    twist: 0,
    tilt: 0,
    vortexPull: 0.35,
    coreSpin: 0.4,
  }),
  // Pl@ntNet + GPT vision scanning — emerald, low head-on, fast inward vortex.
  scan: phase("#34d399", "#a3e635", "#86efac", "#22d3ee", "#04140c", [0, 0.5, 6.3], {
    radius: 3.1,
    vAmpAngle: 0.3,
    vAmpIndex: 0,
    twist: 0.6,
    tilt: 0.16,
    vortexPull: 1.15,
    coreSpin: 1.1,
  }),
  // Consolidating — violet, high top-down angle, satellites pull into a tight ring.
  consolidate: phase("#a78bfa", "#6366f1", "#c4b5fd", "#38bdf8", "#0b0720", [4.6, 4.6, 3], {
    radius: 1.75,
    vAmpAngle: 0,
    vAmpIndex: 0,
    twist: 0,
    tilt: -0.45,
    vortexPull: 0.7,
    coreSpin: -0.8,
  }),
  // Pet toxicity — rose/red, tilted side view, formation explodes into a HELIX.
  toxicity: phase("#fb7185", "#f43f5e", "#fda4af", "#f59e0b", "#1a0810", [-5, 0.6, 3.6], {
    radius: 2.2,
    vAmpAngle: 0,
    vAmpIndex: 1.7,
    twist: 3.2,
    tilt: 0.5,
    vortexPull: -0.6,
    coreSpin: 0.6,
  }),
  // Wikipedia articles — amber/gold, opposite side, formation flattens to a wide DISC.
  articles: phase("#fbbf24", "#f59e0b", "#fde68a", "#38bdf8", "#161003", [5.6, 1.1, 2.6], {
    radius: 3.7,
    vAmpAngle: 0,
    vAmpIndex: 0,
    twist: 0,
    tilt: 0.02,
    vortexPull: 0.5,
    coreSpin: 0.5,
  }),
  // Species profile enrich — emerald→gold, close-in, satellites CONVERGE on the core.
  enrich: phase("#34d399", "#fde68a", "#86efac", "#fbbf24", "#04140c", [0, 1.0, 3.7], {
    radius: 1.3,
    vAmpAngle: 0.2,
    vAmpIndex: 0,
    twist: 1.2,
    tilt: 0.25,
    vortexPull: 0.9,
    coreSpin: 1.4,
  }),
  // Match locked in — triumphant white-gold, pulled back, full spin.
  complete: phase("#fde68a", "#ffffff", "#fff7cc", "#7dd8a3", "#071a10", [0, 2.2, 7.4], {
    radius: 2.6,
    vAmpAngle: 0.5,
    vAmpIndex: 0,
    twist: 6.28,
    tilt: 0,
    vortexPull: 0.3,
    coreSpin: 2.2,
  }),
};

const PHASE_FALLBACK_COLOR: Record<string, string> = {
  start: "#38bdf8",
  scan: "#34d399",
  consolidate: "#a78bfa",
  toxicity: "#fb7185",
  articles: "#fbbf24",
  enrich: "#5eead4",
  complete: "#fde68a",
};

function phaseKeyFor(stepKey: string): string {
  return stepKey === "plantnet" || stepKey === "openai" ? "scan" : stepKey;
}

function derivePhase(steps: IdentifySceneStep[], celebrate: boolean): string {
  if (celebrate) return "complete";
  const running = steps.find((s) => s.status === "running");
  if (running) return phaseKeyFor(running.key);
  const lastDone = [...steps].reverse().find((s) => s.status === "done");
  if (lastDone) return phaseKeyFor(lastDone.key);
  return "start";
}

// ---- Shared, per-frame animated chamber state ----------------------------

interface ChamberState {
  accent: THREE.Color;
  accent2: THREE.Color;
  vortexColor: THREE.Color;
  camTarget: THREE.Vector3;
  radius: number;
  vAmpAngle: number;
  vAmpIndex: number;
  twist: number;
  tilt: number;
  vortexPull: number;
  coreSpin: number;
}

function createChamberState(): ChamberState {
  const p = PHASES.start;
  return {
    accent: p.accent.clone(),
    accent2: p.accent2.clone(),
    vortexColor: p.light1.clone(),
    camTarget: p.cam.clone(),
    radius: p.radius,
    vAmpAngle: p.vAmpAngle,
    vAmpIndex: p.vAmpIndex,
    twist: p.twist,
    tilt: p.tilt,
    vortexPull: p.vortexPull,
    coreSpin: p.coreSpin,
  };
}

const damp = (current: number, target: number, lambda: number, dt: number) =>
  THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));

// ---- Glow sprite texture (shared) ----------------------------------------
// A soft radial-gradient sprite for every glow. Built once and shared —
// additive blending fakes bloom without a postprocessing pass.
let _glowTexture: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (_glowTexture) return _glowTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  _glowTexture = new THREE.CanvasTexture(canvas);
  return _glowTexture;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

// ---- Scene director: damps the chamber toward the active phase -----------

function ChamberDirector({
  cfg,
  phaseKey,
  light1,
  light2,
  fogRef,
}: {
  cfg: ChamberState;
  phaseKey: string;
  light1: React.RefObject<THREE.PointLight>;
  light2: React.RefObject<THREE.PointLight>;
  fogRef: React.RefObject<THREE.Fog>;
}) {
  useFrame((state, delta) => {
    const target = PHASES[phaseKey] ?? PHASES.start;
    const k = 1 - Math.exp(-2.6 * delta);

    cfg.accent.lerp(target.accent, k);
    cfg.accent2.lerp(target.accent2, k);
    cfg.vortexColor.lerp(target.light1, k);
    cfg.camTarget.lerp(target.cam, k);

    cfg.radius = damp(cfg.radius, target.radius, 2.6, delta);
    cfg.vAmpAngle = damp(cfg.vAmpAngle, target.vAmpAngle, 2.6, delta);
    cfg.vAmpIndex = damp(cfg.vAmpIndex, target.vAmpIndex, 2.6, delta);
    cfg.twist = damp(cfg.twist, target.twist, 2.6, delta);
    cfg.tilt = damp(cfg.tilt, target.tilt, 2.6, delta);
    cfg.vortexPull = damp(cfg.vortexPull, target.vortexPull, 2.6, delta);
    cfg.coreSpin = damp(cfg.coreSpin, target.coreSpin, 2.6, delta);

    if (light1.current) light1.current.color.lerp(target.light1, k);
    if (light2.current) light2.current.color.lerp(target.light2, k);
    if (fogRef.current) fogRef.current.color.lerp(target.fog, k);
    if (state.scene.background instanceof THREE.Color) {
      state.scene.background.lerp(target.fog, k);
    }
  });
  return null;
}

function CameraRig({ cfg }: { cfg: ChamberState }) {
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    tmp.copy(cfg.camTarget);
    // Gentle orbital life layered on top of the phase framing.
    tmp.x += Math.sin(t * 0.2) * 0.4;
    tmp.z += Math.cos(t * 0.2) * 0.4;
    state.camera.position.lerp(tmp, 1 - Math.exp(-2 * delta));
    state.camera.lookAt(0, 0, 0);
  });
  return null;
}

function Core({
  cfg,
  progress,
  active,
}: {
  cfg: ChamberState;
  progress: number;
  active: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const wire = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Sprite>(null);
  const mat = useRef<THREE.MeshStandardMaterial & { distort: number; speed: number }>(
    null as never
  );
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    tint.copy(cfg.accent).lerp(cfg.accent2, progress * 0.6);

    if (mesh.current) {
      mesh.current.rotation.y += delta * cfg.coreSpin;
      mesh.current.rotation.x = Math.sin(t * 0.4) * 0.25;
    }
    if (wire.current) {
      wire.current.rotation.y -= delta * (0.5 + cfg.coreSpin * 0.2);
      wire.current.rotation.z += delta * 0.2;
      wire.current.scale.setScalar(1.25 + Math.sin(t * 1.5) * 0.06);
      (wire.current.material as THREE.MeshBasicMaterial).color.copy(cfg.accent2);
    }
    if (mat.current) {
      mat.current.color.copy(tint);
      mat.current.emissive.copy(tint);
      mat.current.emissiveIntensity = 0.4 + progress * 0.9;
      mat.current.distort = (active ? 0.45 : 0.25) + progress * 0.2;
      mat.current.speed = active ? 3.5 : 1.5;
    }
    if (glow.current) {
      const pulse = 1.7 + progress * 0.9 + Math.sin(t * (active ? 5 : 2)) * 0.18;
      glow.current.scale.setScalar(pulse);
      const material = glow.current.material as THREE.SpriteMaterial;
      material.color.copy(tint);
      material.opacity = 0.45 + progress * 0.35;
    }
  });

  return (
    <group>
      <sprite ref={glow}>
        <spriteMaterial
          map={glowTexture()}
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[0.9, 6]} />
        <MeshDistortMaterial
          ref={mat as never}
          color="#38bdf8"
          emissive="#38bdf8"
          emissiveIntensity={0.5}
          roughness={0.15}
          metalness={0.2}
          distort={0.3}
          speed={2}
        />
      </mesh>
      <mesh ref={wire}>
        <icosahedronGeometry args={[0.9, 1]} />
        <meshBasicMaterial color="#e0f2fe" wireframe transparent opacity={0.18} />
      </mesh>
    </group>
  );
}

const UP = new THREE.Vector3(0, 1, 0);

function EngineNode({
  cfg,
  index,
  total,
  color,
  status,
}: {
  cfg: ChamberState;
  index: number;
  total: number;
  color: string;
  status?: IdentifySceneStepStatus;
}) {
  const visual = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const glow = useRef<THREE.Sprite>(null);
  const beam = useRef<THREE.Mesh>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const packet = useRef<THREE.Sprite>(null);

  const cur = useMemo(() => {
    const a = (index / total) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 2.8, 0, Math.sin(a) * 2.8);
  }, [index, total]);
  const target = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const displayColor = useMemo(
    () => new THREE.Color(status === "error" ? ERROR_COLOR : color),
    [color, status]
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // Formation target for this satellite, derived from the current phase.
    const angleBase = (index / total) * Math.PI * 2;
    const angle = angleBase + cfg.twist * (index / total);
    const y =
      cfg.vAmpAngle * Math.sin(angleBase * 2) +
      cfg.vAmpIndex * (index / Math.max(1, total - 1) - 0.5) * 2;
    target.set(Math.cos(angle) * cfg.radius, y, Math.sin(angle) * cfg.radius);
    cur.lerp(target, 1 - Math.exp(-3 * delta));

    if (visual.current) visual.current.position.copy(cur);

    // Status-driven visuals.
    let scale = 0.28;
    let emissive = 0.3;
    let glowOpacity = 0.15;
    let glowScale = 0.9;
    if (status === "running") {
      const pulse = 1 + Math.sin(t * 8) * 0.18;
      scale = 0.42 * pulse;
      emissive = 1.5;
      glowOpacity = 0.75;
      glowScale = 1.7 * pulse;
    } else if (status === "done") {
      scale = 0.36;
      emissive = 0.95;
      glowOpacity = 0.45;
      glowScale = 1.2;
    } else if (status === "error") {
      const flicker = Math.sin(t * 20) > 0 ? 1 : 0.35;
      scale = 0.32;
      emissive = 1.3 * flicker;
      glowOpacity = 0.5 * flicker;
      glowScale = 1.1;
    } else if (status === "skipped") {
      scale = 0.2;
      emissive = 0.08;
      glowOpacity = 0.05;
      glowScale = 0.6;
    }

    if (mesh.current) {
      mesh.current.rotation.y = t * (status === "running" ? 2.2 : 0.4);
      mesh.current.rotation.x = t * 0.3;
      mesh.current.scale.setScalar(scale);
    }
    if (matRef.current) {
      matRef.current.color.copy(displayColor);
      matRef.current.emissive.copy(displayColor);
      matRef.current.emissiveIntensity = emissive;
    }
    if (glow.current) {
      glow.current.scale.setScalar(glowScale);
      const material = glow.current.material as THREE.SpriteMaterial;
      material.color.copy(displayColor);
      material.opacity = glowOpacity;
    }

    // Beam from the (moving) satellite to the core at the origin.
    const length = cur.length() || 0.0001;
    if (beam.current) {
      beam.current.position.copy(cur).multiplyScalar(0.5);
      quat.setFromUnitVectors(UP, cur.clone().normalize());
      beam.current.quaternion.copy(quat);
      beam.current.scale.set(1, length, 1);
    }
    if (beamMat.current) {
      beamMat.current.color.copy(displayColor);
      beamMat.current.opacity =
        status === "running"
          ? 0.35 + Math.sin(t * 6) * 0.18
          : status === "done"
            ? 0.16
            : 0.04;
    }
    if (packet.current) {
      const on = status === "running";
      packet.current.visible = on;
      if (on) {
        const p = (t * 0.85) % 1;
        packet.current.position.copy(cur).multiplyScalar(1 - p);
        packet.current.scale.setScalar(0.5 + Math.sin(p * Math.PI) * 0.35);
        (packet.current.material as THREE.SpriteMaterial).color.copy(displayColor);
      }
    }
  });

  return (
    <group>
      {/* Beam + travelling packet, in formation-local space (core at origin). */}
      <mesh ref={beam}>
        <cylinderGeometry args={[0.02, 0.02, 1, 8]} />
        <meshBasicMaterial
          ref={beamMat}
          color={color}
          transparent
          opacity={0.08}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <sprite ref={packet} visible={false}>
        <spriteMaterial
          map={glowTexture()}
          color={color}
          transparent
          opacity={0.9}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      {/* The satellite itself. */}
      <group ref={visual}>
        <sprite ref={glow}>
          <spriteMaterial
            map={glowTexture()}
            transparent
            opacity={0.2}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
        <mesh ref={mesh}>
          <icosahedronGeometry args={[0.5, 1]} />
          <meshStandardMaterial
            ref={matRef}
            color={color}
            emissive={color}
            emissiveIntensity={0.4}
            roughness={0.25}
            metalness={0.3}
            flatShading
          />
        </mesh>
      </group>
    </group>
  );
}

function EngineField({ cfg, steps }: { cfg: ChamberState; steps: IdentifySceneStep[] }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.rotation.x = damp(group.current.rotation.x, cfg.tilt, 2.6, delta);
    group.current.rotation.y += delta * 0.15;
  });
  return (
    <group ref={group}>
      {steps.map((step, i) => (
        <EngineNode
          key={step.key}
          cfg={cfg}
          index={i}
          total={steps.length}
          color={step.color}
          status={step.status}
        />
      ))}
    </group>
  );
}

function Vortex({ cfg, count = 320 }: { cfg: ChamberState; count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const state = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const angle = new Float32Array(count);
    const radius = new Float32Array(count);
    const height = new Float32Array(count);
    const speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      angle[i] = Math.random() * Math.PI * 2;
      radius[i] = 1 + Math.random() * 3.2;
      height[i] = (Math.random() - 0.5) * 2.4;
      speed[i] = 0.4 + Math.random() * 0.8;
      positions[i * 3] = Math.cos(angle[i]) * radius[i];
      positions[i * 3 + 1] = height[i];
      positions[i * 3 + 2] = Math.sin(angle[i]) * radius[i];
    }
    return { positions, angle, radius, height, speed };
  }, [count]);

  useFrame((_, delta) => {
    if (!ref.current) return;
    const attr = ref.current.geometry.attributes.position as THREE.BufferAttribute;
    const pull = cfg.vortexPull;
    const dir = Math.sign(pull) || 1;
    const mag = Math.abs(pull);
    for (let i = 0; i < count; i++) {
      state.angle[i] += delta * (0.8 + state.speed[i]) * mag;
      state.radius[i] -= delta * state.speed[i] * mag * dir;
      state.height[i] *= 1 - delta * 0.4 * mag;
      if (state.radius[i] < 0.4 || state.radius[i] > 4.2) {
        state.radius[i] = dir > 0 ? 2.6 + Math.random() * 1.6 : 0.5 + Math.random();
        state.height[i] = (Math.random() - 0.5) * 2.4;
        state.angle[i] = Math.random() * Math.PI * 2;
      }
      attr.setXYZ(
        i,
        Math.cos(state.angle[i]) * state.radius[i],
        state.height[i],
        Math.sin(state.angle[i]) * state.radius[i]
      );
    }
    attr.needsUpdate = true;
    const material = ref.current.material as THREE.PointsMaterial;
    material.color.copy(cfg.vortexColor);
    material.opacity = 0.35 + mag * 0.4;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={state.positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        color="#a7f3d0"
        transparent
        opacity={0.5}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Burst({ celebrate, color }: { celebrate: boolean; color: string }) {
  const ring = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.Sprite>(null);
  const started = useRef<number | null>(null);
  const LIFE = 1.4;

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;
    if (!celebrate) {
      started.current = null;
      if (ring.current) ring.current.visible = false;
      if (flash.current) flash.current.visible = false;
      return;
    }
    if (started.current === null) started.current = elapsed;
    const dt = elapsed - started.current;
    const done = dt > LIFE;

    if (ring.current) {
      ring.current.visible = !done;
      if (!done) {
        const p = dt / LIFE;
        const scale = 0.2 + p * 5.5;
        ring.current.scale.set(scale, scale, scale);
        (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.85;
      }
    }
    if (flash.current) {
      flash.current.visible = !done;
      if (!done) {
        const p = dt / LIFE;
        flash.current.scale.setScalar(3 + p * 3);
        (flash.current.material as THREE.SpriteMaterial).opacity = (1 - p) * 0.7;
      }
    }
  });

  return (
    <group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.9, 1, 64]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <sprite ref={flash} visible={false}>
        <spriteMaterial
          map={glowTexture()}
          color={color}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </group>
  );
}

export default function IdentifyScene({
  steps,
  active,
  celebrate,
}: {
  steps: IdentifySceneStep[];
  active: boolean;
  celebrate: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const cfg = useRef(createChamberState()).current;

  const light1 = useRef<THREE.PointLight>(null);
  const light2 = useRef<THREE.PointLight>(null);
  const fogRef = useRef<THREE.Fog>(null);

  const phaseKey = derivePhase(steps, celebrate);

  const considered =
    steps.filter((s) => s.status && s.status !== "skipped").length || steps.length || 1;
  const doneCount = steps.filter((s) => s.status === "done").length;
  const progress = considered ? doneCount / considered : 0;

  if (reducedMotion) {
    const color = PHASE_FALLBACK_COLOR[phaseKey] ?? "#38bdf8";
    return (
      <div className="absolute inset-0 overflow-hidden">
        <div
          className={`absolute inset-0 transition-colors duration-700 ${
            active ? "animate-pulse" : ""
          }`}
          style={{
            background: `linear-gradient(135deg, ${color}33, transparent 60%)`,
          }}
        />
        <div className="absolute inset-0 grid place-items-center">
          <div
            className="h-24 w-24 rounded-full blur-xl transition-all duration-700"
            style={{
              background: `radial-gradient(circle, ${color}, transparent 70%)`,
              opacity: 0.4 + progress * 0.5,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <Canvas camera={{ position: [0, 1.6, 6], fov: 50 }} dpr={[1, 2]}>
      <color attach="background" args={["#04120b"]} />
      <fog ref={fogRef} attach="fog" args={["#04120b", 5, 14]} />
      <ambientLight intensity={0.4} />
      <pointLight ref={light1} position={[4, 5, 4]} intensity={2.5} color="#7dd8a3" />
      <pointLight ref={light2} position={[-4, -3, -3]} intensity={1.4} color="#ec4899" />
      <ChamberDirector
        cfg={cfg}
        phaseKey={phaseKey}
        light1={light1}
        light2={light2}
        fogRef={fogRef}
      />
      <CameraRig cfg={cfg} />
      <Core cfg={cfg} progress={progress} active={active} />
      <EngineField cfg={cfg} steps={steps} />
      <Vortex cfg={cfg} />
      <Burst celebrate={celebrate} color="#fde68a" />
      <Sparkles
        count={60}
        scale={[10, 6, 10]}
        size={2.5}
        speed={active ? 0.6 : 0.2}
        color="#bbf7d0"
        opacity={0.5}
      />
    </Canvas>
  );
}
