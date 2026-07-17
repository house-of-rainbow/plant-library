import { Suspense, useMemo } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { PlantInstance, Position3D } from "../types";

interface GardenSceneEditorProps {
  sceneUrl?: string | null;
  plants: PlantInstance[];
  selectedPlantId: string | null;
  onSelectPlant: (plantId: string) => void;
  onPlacePlant: (position: Position3D) => void;
}

function roundPosition(point: THREE.Vector3): Position3D {
  return {
    x: Number(point.x.toFixed(3)),
    y: Number(point.y.toFixed(3)),
    z: Number(point.z.toFixed(3)),
  };
}

function PlacementSurface({ onPlacePlant }: { onPlacePlant: (position: Position3D) => void }) {
  function handlePlace(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onPlacePlant(roundPosition(event.point));
  }

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.01, 0]}
      onPointerDown={handlePlace}
    >
      <planeGeometry args={[120, 120]} />
      <meshStandardMaterial color="#07140f" transparent opacity={0.001} />
    </mesh>
  );
}

function SceneModel({ url, onPlacePlant }: { url: string; onPlacePlant: (position: Position3D) => void }) {
  const gltf = useGLTF(url);

  const { scene, offset, scale } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxAxis = Math.max(size.x || 0, size.y || 0, size.z || 0, 1);
    const scale = maxAxis > 18 ? 18 / maxAxis : 1;

    return {
      scene,
      offset: [-center.x, -center.y, -center.z] as [number, number, number],
      scale,
    };
  }, [gltf.scene]);

  function handlePlace(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onPlacePlant(roundPosition(event.point));
  }

  return (
    <group scale={[scale, scale, scale]} onPointerDown={handlePlace}>
      <primitive object={scene} position={offset} />
    </group>
  );
}

function PlantPin({
  plant,
  selected,
  onSelectPlant,
}: {
  plant: PlantInstance;
  selected: boolean;
  onSelectPlant: (plantId: string) => void;
}) {
  if (!plant.position_3d) {
    return null;
  }

  const imageUrl = plant.image_urls[0];
  const label = plant.nickname || plant.plant_class?.common_name || "Plant";

  return (
    <group position={[plant.position_3d.x, plant.position_3d.y, plant.position_3d.z]}>
      <mesh position={[0, 0.12, 0]}>
        <sphereGeometry args={[0.08, 20, 20]} />
        <meshStandardMaterial color={selected ? "#facc15" : "#7dd3a8"} emissive="#7dd3a8" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, -0.14, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.3, 12]} />
        <meshStandardMaterial color="#d1fae5" />
      </mesh>
      <Html distanceFactor={9} position={[0, 0.3, 0]}>
        <button
          type="button"
          onClick={() => onSelectPlant(plant.id)}
          className={`flex items-center gap-2 rounded-full border px-2 py-1 text-xs shadow-lg backdrop-blur ${
            selected
              ? "border-yellow-300/70 bg-yellow-200/20 text-yellow-50"
              : "border-white/15 bg-[#08150f]/85 text-white"
          }`}
        >
          {imageUrl ? (
            <img src={imageUrl} alt={label} className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10">🌿</span>
          )}
          <span className="max-w-[12rem] truncate">{label}</span>
        </button>
      </Html>
    </group>
  );
}

export default function GardenSceneEditor({
  sceneUrl,
  plants,
  selectedPlantId,
  onSelectPlant,
  onPlacePlant,
}: GardenSceneEditorProps) {
  return (
    <div className="h-[520px] w-full overflow-hidden rounded-[2rem] border border-white/10 bg-[#020a07]">
      <Canvas camera={{ position: [6, 6, 6], fov: 50 }} dpr={[1, 2]}>
        <color attach="background" args={["#020a07"]} />
        <fog attach="fog" args={["#020a07", 12, 40]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[8, 12, 6]} intensity={2.2} color="#f4fff8" />
        <pointLight position={[-8, 6, -6]} intensity={1.2} color="#86efac" />

        <gridHelper args={[40, 40, "#14532d", "#0b2b1f"]} position={[0, 0, 0]} />
        <PlacementSurface onPlacePlant={onPlacePlant} />

        <Suspense fallback={null}>
          {sceneUrl ? <SceneModel url={sceneUrl} onPlacePlant={onPlacePlant} /> : null}
        </Suspense>

        {plants.map((plant) => (
          <PlantPin
            key={plant.id}
            plant={plant}
            selected={plant.id === selectedPlantId}
            onSelectPlant={onSelectPlant}
          />
        ))}

        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      </Canvas>
    </div>
  );
}