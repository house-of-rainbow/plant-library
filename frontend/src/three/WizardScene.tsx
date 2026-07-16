import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";

/**
 * An abstract, plant-oriented germination scene for the onboarding wizard.
 * A luminous seed unfurls into a stylized sprout whose growth tracks the
 * wizard's progress (0 -> 1). Purely decorative and GPU-light.
 */

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function Leaf({
  angle,
  grow,
  delay,
  color,
}: {
  angle: number;
  grow: number;
  delay: number;
  color: string;
}) {
  const ref = useRef<THREE.Mesh>(null);
  // Stagger each leaf's emergence across the overall growth value.
  const local = THREE.MathUtils.clamp((grow - delay) / (1 - delay + 0.0001), 0, 1);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const s = Math.max(0.0001, easeOutBack(local));
    ref.current.scale.set(0.28 * s, 0.9 * s, 0.06 * s);
    // Gentle breathing sway.
    ref.current.rotation.z = angle + Math.sin(t * 0.8 + delay * 6) * 0.08;
  });

  return (
    <group rotation={[0, 0, 0]}>
      <mesh
        ref={ref}
        position={[
          Math.sin(angle) * 0.15,
          0.55 + Math.cos(angle) * 0.05,
          0,
        ]}
        rotation={[0, 0, angle]}
      >
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          roughness={0.3}
          metalness={0.05}
        />
      </mesh>
    </group>
  );
}

function Sprout({ progress, accent }: { progress: number; accent: string }) {
  const group = useRef<THREE.Group>(null);
  const stem = useRef<THREE.Mesh>(null);
  const seed = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 0.25;
    }
    if (stem.current) {
      const g = Math.max(0.0001, progress);
      stem.current.scale.y = g;
      stem.current.position.y = (g * 0.6) / 2 - 0.3;
    }
    if (seed.current) {
      const t = state.clock.elapsedTime;
      seed.current.scale.setScalar(0.22 + Math.sin(t * 1.5) * 0.01);
    }
  });

  const leaves = useMemo(
    () => [
      { angle: 0.5, delay: 0.1 },
      { angle: -0.5, delay: 0.2 },
      { angle: 1.1, delay: 0.35 },
      { angle: -1.1, delay: 0.45 },
      { angle: 0.0, delay: 0.6 },
    ],
    []
  );

  return (
    <group ref={group} position={[0, -0.2, 0]}>
      {/* Seed / bulb at the base */}
      <mesh ref={seed} position={[0, -0.3, 0]}>
        <icosahedronGeometry args={[1, 3]} />
        <meshStandardMaterial
          color="#d9a066"
          emissive="#7a5230"
          emissiveIntensity={0.3}
          roughness={0.6}
        />
      </mesh>

      {/* Stem */}
      <mesh ref={stem} position={[0, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.06, 0.6, 12]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.4}
          roughness={0.4}
        />
      </mesh>

      {/* Leaves unfurling from the top of the stem */}
      <group position={[0, 0.3 * progress, 0]}>
        {leaves.map((l, i) => (
          <Leaf key={i} angle={l.angle} grow={progress} delay={l.delay} color={accent} />
        ))}
      </group>
    </group>
  );
}

function Pollen({ count = 220, accent }: { count?: number; accent: string }) {
  const ref = useRef<THREE.Points>(null);
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 1.2 + Math.random() * 3;
      const a = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 6;
      positions[i * 3 + 2] = Math.sin(a) * r;
      speeds[i] = 0.1 + Math.random() * 0.5;
    }
    return { positions, speeds };
  }, [count]);

  useFrame((state, delta) => {
    if (!ref.current) return;
    const geo = ref.current.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) + speeds[i] * delta;
      if (y > 3) y = -3;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    ref.current.rotation.y = state.clock.elapsedTime * 0.05;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        color={accent}
        transparent
        opacity={0.7}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

export default function WizardScene({
  progress,
  accent = "#45bd7b",
}: {
  progress: number;
  accent?: string;
}) {
  return (
    <Canvas camera={{ position: [0, 0.4, 4], fov: 50 }} dpr={[1, 2]}>
      <fog attach="fog" args={["#04120b", 4, 12]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 4, 3]} intensity={3} color={accent} />
      <pointLight position={[-3, -2, -2]} intensity={1.2} color="#ec4899" />
      <Float speed={1.5} rotationIntensity={0.15} floatIntensity={0.4}>
        <Sprout progress={progress} accent={accent} />
      </Float>
      <Pollen accent={accent} />
      {/* Ground glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.4, 0]}>
        <circleGeometry args={[3, 48]} />
        <meshBasicMaterial color={accent} transparent opacity={0.06} />
      </mesh>
    </Canvas>
  );
}
