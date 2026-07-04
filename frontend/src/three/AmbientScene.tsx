import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Ambient floating-spores background scene. Rendered fixed behind the app for
 * a living, organic atmosphere. GPU-light: a single instanced point cloud.
 */
function Spores({ count = 600 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);

  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 24;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 12;
      speeds[i] = 0.15 + Math.random() * 0.4;
    }
    return { positions, speeds };
  }, [count]);

  useFrame((state, delta) => {
    if (!ref.current) return;
    const geo = ref.current.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) + speeds[i] * delta;
      if (y > 8) y = -8;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    ref.current.rotation.y = state.clock.elapsedTime * 0.02;
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
        size={0.06}
        color="#7dd8a3"
        transparent
        opacity={0.5}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

export default function AmbientScene() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 10], fov: 60 }} dpr={[1, 1.5]}>
        <fog attach="fog" args={["#04120b", 8, 22]} />
        <Spores />
      </Canvas>
    </div>
  );
}
