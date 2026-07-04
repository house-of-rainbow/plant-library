import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Icosahedron, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";
import type { HealthStatus } from "../types";
import { HEALTH_META } from "../lib/format";

/**
 * A living, distorting orb that visualizes a plant's vitality. The color maps
 * to health status and the distortion "breathes". Used inside cards and the
 * detail hero. Interactive spin on pointer drag via Orbitless auto-rotate.
 */
function Orb({ color, intensity }: { color: string; intensity: number }) {
  const mesh = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!mesh.current) return;
    const t = state.clock.elapsedTime;
    mesh.current.rotation.y = t * 0.35;
    mesh.current.rotation.x = Math.sin(t * 0.4) * 0.2;
  });

  return (
    <Float speed={2} rotationIntensity={0.6} floatIntensity={1.2}>
      <Icosahedron ref={mesh} args={[1, 8]}>
        <MeshDistortMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.4}
          roughness={0.25}
          metalness={0.1}
          distort={0.35 * intensity}
          speed={1.8}
        />
      </Icosahedron>
    </Float>
  );
}

export default function PlantOrb({
  health,
  className = "",
}: {
  health: HealthStatus;
  className?: string;
}) {
  const meta = HEALTH_META[health];
  // Deceased/dormant plants distort less (less "alive").
  const intensity =
    health === "deceased" ? 0.15 : health === "dormant" ? 0.4 : 1;

  return (
    <div className={className}>
      <Canvas camera={{ position: [0, 0, 3.2], fov: 45 }} dpr={[1, 2]}>
        <ambientLight intensity={0.6} />
        <pointLight position={[3, 3, 3]} intensity={2} color={meta.color} />
        <pointLight position={[-3, -2, -2]} intensity={1} color="#ec4899" />
        <Orb color={meta.color} intensity={intensity} />
      </Canvas>
    </div>
  );
}
