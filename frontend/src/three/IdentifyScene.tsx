import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { MeshDistortMaterial, Sparkles } from "@react-three/drei";
import * as THREE from "three";

/**
 * The "identification chamber" — a deliberately over-the-top 3D visualization
 * of the plant-ID pipeline. A distorting neural core sits at the center while
 * each engine step orbits as a glowing satellite. Running steps fire energy
 * beams (with travelling packets) into the core, a particle vortex spirals
 * inward while work is active, and a shockwave bursts when a match locks in.
 *
 * This is the focal experience of the identify flow, so — unlike the ambient
 * background scenes — it stays on for touch devices. It only steps aside for
 * users who ask for reduced motion.
 */

export type IdentifySceneStepStatus = "running" | "done" | "error" | "skipped";

export interface IdentifySceneStep {
  key: string;
  color: string;
  status?: IdentifySceneStepStatus;
}

const ERROR_COLOR = "#f87171";

// A soft radial-gradient sprite used for every glow in the scene. Built once
// and shared — additive blending fakes bloom without a postprocessing pass.
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

function CameraRig() {
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    state.camera.position.x = Math.sin(t * 0.15) * 6;
    state.camera.position.z = Math.cos(t * 0.15) * 6;
    state.camera.position.y = 1.6 + Math.sin(t * 0.3) * 0.35;
    state.camera.lookAt(0, 0, 0);
  });
  return null;
}

function Core({ progress, active }: { progress: number; active: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const wire = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Sprite>(null);
  // MeshDistortMaterial has no ref type exported; treat as a mutable material.
  const mat = useRef<THREE.MeshStandardMaterial & { distort: number; speed: number }>(
    null as never
  );

  const cold = useMemo(() => new THREE.Color("#38bdf8"), []);
  const hot = useMemo(() => new THREE.Color("#fde68a"), []);
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    tint.copy(cold).lerp(hot, progress);

    if (mesh.current) {
      mesh.current.rotation.y += delta * (0.3 + progress * 0.6);
      mesh.current.rotation.x = Math.sin(t * 0.4) * 0.2;
    }
    if (wire.current) {
      wire.current.rotation.y -= delta * 0.5;
      wire.current.rotation.z += delta * 0.2;
      wire.current.scale.setScalar(1.25 + Math.sin(t * 1.5) * 0.05);
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
        <meshBasicMaterial color="#e0f2fe" wireframe transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

function Beam({
  from,
  color,
  status,
}: {
  from: [number, number, number];
  color: string;
  status?: IdentifySceneStepStatus;
}) {
  const active = status === "running";
  const done = status === "done";
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const packet = useRef<THREE.Sprite>(null);

  const target = useMemo(() => new THREE.Vector3(...from), [from]);
  const length = useMemo(() => target.length(), [target]);
  const mid = useMemo(() => target.clone().multiplyScalar(0.5), [target]);
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), target.clone().normalize());
    return q;
  }, [target]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (matRef.current) {
      matRef.current.opacity = active
        ? 0.35 + Math.sin(t * 6) * 0.18
        : done
          ? 0.16
          : 0.04;
    }
    if (packet.current) {
      packet.current.visible = active;
      if (active) {
        const p = (t * 0.85) % 1;
        // p = 0 at the satellite, 1 at the core.
        packet.current.position.copy(target.clone().multiplyScalar(1 - p));
        packet.current.scale.setScalar(0.5 + Math.sin(p * Math.PI) * 0.35);
      }
    }
  });

  return (
    <group>
      <mesh position={mid} quaternion={quaternion}>
        <cylinderGeometry args={[0.02, 0.02, length, 8]} />
        <meshBasicMaterial
          ref={matRef}
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
    </group>
  );
}

function EngineNode({
  color,
  status,
}: {
  color: string;
  status?: IdentifySceneStepStatus;
}) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const glow = useRef<THREE.Sprite>(null);

  const displayColor = useMemo(
    () => new THREE.Color(status === "error" ? ERROR_COLOR : color),
    [color, status]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
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
    }
    if (group.current) group.current.scale.setScalar(scale);
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
  });

  return (
    <group ref={group}>
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
  );
}

function Vortex({ count = 320, active }: { count?: number; active: boolean }) {
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
    const pull = active ? 1 : 0.25;
    for (let i = 0; i < count; i++) {
      state.angle[i] += delta * (0.8 + state.speed[i]) * pull;
      state.radius[i] -= delta * state.speed[i] * pull;
      state.height[i] *= 1 - delta * 0.4 * pull;
      if (state.radius[i] < 0.4) {
        state.radius[i] = 2.6 + Math.random() * 1.6;
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
        opacity={active ? 0.8 : 0.35}
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

  const total = steps.length || 1;
  const doneCount = steps.filter((s) => s.status === "done").length;
  const considered =
    steps.filter((s) => s.status && s.status !== "skipped").length || total;
  const progress = considered ? doneCount / considered : 0;

  const positions = useMemo(
    () =>
      steps.map((_, i) => {
        const a = (i / total) * Math.PI * 2;
        const r = 2.8;
        return [Math.cos(a) * r, Math.sin(a * 2) * 0.45, Math.sin(a) * r] as [
          number,
          number,
          number,
        ];
      }),
    [steps, total]
  );

  if (reducedMotion) {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <div
          className={`absolute inset-0 bg-gradient-to-br from-canopy-500/25 via-sky-500/10 to-fuchsia-500/20 ${
            active ? "animate-pulse" : ""
          }`}
        />
        <div className="absolute inset-0 grid place-items-center">
          <div
            className="h-24 w-24 rounded-full blur-xl transition-all"
            style={{
              background: celebrate
                ? "radial-gradient(circle, #fde68a, transparent 70%)"
                : "radial-gradient(circle, #38bdf8, transparent 70%)",
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
      <fog attach="fog" args={["#04120b", 5, 14]} />
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 5, 4]} intensity={2.5} color="#7dd8a3" />
      <pointLight position={[-4, -3, -3]} intensity={1.4} color="#ec4899" />
      <CameraRig />
      <Core progress={progress} active={active} />
      {steps.map((step, i) => (
        <group key={step.key}>
          <Beam from={positions[i]} color={step.color} status={step.status} />
          <group position={positions[i]}>
            <EngineNode color={step.color} status={step.status} />
          </group>
        </group>
      ))}
      <Vortex active={active} />
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
