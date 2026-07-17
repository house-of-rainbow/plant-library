import { Suspense, useMemo } from "react";
import { Canvas, type ThreeEvent, useLoader } from "@react-three/fiber";
import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { PlantInstance, Position3D } from "../types";

const FALLBACK_SCENE_COLOR = new THREE.Color("#8bb99d");

// Plants are placed on a flat 2D map over the mesh: we keep the horizontal
// (x/z) click location but pin the vertical axis to a constant ground height.
const PLACEMENT_HEIGHT = 0;

// Each plant renders as a raised flag on a pole so its marker/label float above
// the mesh and stay easy to spot from any orbit angle.
const POLE_HEIGHT = 2.4;

interface GardenSceneEditorProps {
  sceneUrl?: string | null;
  sceneName?: string | null;
  plants: PlantInstance[];
  selectedPlantId: string | null;
  onSelectPlant: (plantId: string) => void;
  onPlacePlant: (position: Position3D) => void;
}

function roundPosition(point: THREE.Vector3): Position3D {
  return {
    x: Number(point.x.toFixed(3)),
    y: PLACEMENT_HEIGHT,
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

function getSceneScale(size: THREE.Vector3): number {
  const maxAxis = Math.max(size.x || 0, size.y || 0, size.z || 0, 1);
  return maxAxis > 18 ? 18 / maxAxis : 1;
}

function brightenImportedObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (!child.geometry.getAttribute("normal")) {
      child.geometry.computeVertexNormals();
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : child.material
        ? [child.material]
        : [];

    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) &&
          !(material instanceof THREE.MeshPhongMaterial) &&
          !(material instanceof THREE.MeshLambertMaterial) &&
          !(material instanceof THREE.MeshBasicMaterial)) {
        continue;
      }

      material.vertexColors = false;
      const hasTexture = "map" in material && !!material.map;
      const colorLuminance = material.color.r + material.color.g + material.color.b;
      if (hasTexture && material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.needsUpdate = true;
        if (colorLuminance < 0.6) {
          material.color.setRGB(1, 1, 1);
        }
      } else if (colorLuminance < 0.18) {
        material.color.copy(FALLBACK_SCENE_COLOR);
      }

      if ("emissiveMap" in material && material.emissiveMap) {
        material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        material.emissiveMap.needsUpdate = true;
      }

      if ("emissive" in material) {
        material.emissive = material.emissive || new THREE.Color("#000000");
        if (material.emissive.r + material.emissive.g + material.emissive.b < 0.12) {
          material.emissive.copy(new THREE.Color("#163528"));
        }
      }
      if ("emissiveIntensity" in material && material.emissiveIntensity !== undefined) {
        material.emissiveIntensity = Math.max(material.emissiveIntensity ?? 0, 0.45);
      }
      if ("roughness" in material && material.roughness !== undefined) {
        material.roughness = Math.min(material.roughness ?? 0.8, 0.9);
      }
      if ("metalness" in material && material.metalness !== undefined) {
        material.metalness = Math.min(material.metalness ?? 0.1, 0.2);
      }
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
    }
  });
}

function fitObject(object: THREE.Object3D) {
  brightenImportedObject(object);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return {
    object,
    offset: [-center.x, -box.min.y, -center.z] as [number, number, number],
    scale: getSceneScale(size),
  };
}

function fitGeometry(source: THREE.BufferGeometry) {
  const geometry = source.clone();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  geometry.translate(-center.x, -box.min.y, -center.z);
  geometry.computeVertexNormals();
  return {
    geometry,
    scale: getSceneScale(size),
  };
}

function SceneModelGLTF({ url, onPlacePlant }: { url: string; onPlacePlant: (position: Position3D) => void }) {
  const gltf = useGLTF(url);

  const { object, offset, scale } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    return fitObject(scene);
  }, [gltf.scene]);

  function handlePlace(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onPlacePlant(roundPosition(event.point));
  }

  return (
    <group scale={[scale, scale, scale]} onPointerDown={handlePlace}>
      <primitive object={object} position={offset} />
    </group>
  );
}

function SceneModelFBX({ url, onPlacePlant }: { url: string; onPlacePlant: (position: Position3D) => void }) {
  const fbx = useLoader(FBXLoader, url) as THREE.Group;

  const { object, offset, scale } = useMemo(() => {
    return fitObject(fbx.clone(true));
  }, [fbx]);

  function handlePlace(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onPlacePlant(roundPosition(event.point));
  }

  return (
    <group scale={[scale, scale, scale]} onPointerDown={handlePlace}>
      <primitive object={object} position={offset} />
    </group>
  );
}

function SceneModelOBJ({ url, onPlacePlant }: { url: string; onPlacePlant: (position: Position3D) => void }) {
  const obj = useLoader(OBJLoader, url) as THREE.Group;

  const { object, offset, scale } = useMemo(() => {
    return fitObject(obj.clone(true));
  }, [obj]);

  function handlePlace(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onPlacePlant(roundPosition(event.point));
  }

  return (
    <group scale={[scale, scale, scale]} onPointerDown={handlePlace}>
      <primitive object={object} position={offset} />
    </group>
  );
}

function SceneModelDAE({ url, onPlacePlant }: { url: string; onPlacePlant: (position: Position3D) => void }) {
  const collada = useLoader(ColladaLoader, url) as { scene: THREE.Group };

  const { object, offset, scale } = useMemo(() => {
    return fitObject(collada.scene.clone(true));
  }, [collada.scene]);

  function handlePlace(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onPlacePlant(roundPosition(event.point));
  }

  return (
    <group scale={[scale, scale, scale]} onPointerDown={handlePlace}>
      <primitive object={object} position={offset} />
    </group>
  );
}

function SceneModelSTL({ url, onPlacePlant }: { url: string; onPlacePlant: (position: Position3D) => void }) {
  const source = useLoader(STLLoader, url) as THREE.BufferGeometry;

  const { geometry, scale } = useMemo(() => {
    return fitGeometry(source);
  }, [source]);

  function handlePlace(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onPlacePlant(roundPosition(event.point));
  }

  return (
    <mesh geometry={geometry} scale={[scale, scale, scale]} onPointerDown={handlePlace}>
      <meshStandardMaterial color="#8ac5a2" metalness={0.1} roughness={0.7} />
    </mesh>
  );
}

function sceneExtension(url?: string | null, name?: string | null): string {
  const value = (name || url || "").split("?")[0];
  const ext = value.split(".").pop()?.toLowerCase();
  return ext ?? "";
}

function SceneModel({
  url,
  name,
  onPlacePlant,
}: {
  url: string;
  name?: string | null;
  onPlacePlant: (position: Position3D) => void;
}) {
  const ext = sceneExtension(url, name);

  if (ext === "glb") {
    return <SceneModelGLTF url={url} onPlacePlant={onPlacePlant} />;
  }
  if (ext === "fbx") {
    return <SceneModelFBX url={url} onPlacePlant={onPlacePlant} />;
  }
  if (ext === "obj") {
    return <SceneModelOBJ url={url} onPlacePlant={onPlacePlant} />;
  }
  if (ext === "dae") {
    return <SceneModelDAE url={url} onPlacePlant={onPlacePlant} />;
  }
  if (ext === "stl") {
    return <SceneModelSTL url={url} onPlacePlant={onPlacePlant} />;
  }

  return null;
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
    <group position={[plant.position_3d.x, PLACEMENT_HEIGHT, plant.position_3d.z]}>
      {/* Base marker rooted on the ground so the pin's map location is clear. */}
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.09, 0.13, 0.04, 20]} />
        <meshStandardMaterial color={selected ? "#facc15" : "#7dd3a8"} emissive="#7dd3a8" emissiveIntensity={0.25} />
      </mesh>
      {/* Flagpole rising from the ground up to the floating marker. */}
      <mesh position={[0, POLE_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[0.02, 0.02, POLE_HEIGHT, 12]} />
        <meshStandardMaterial color="#d1fae5" emissive="#7dd3a8" emissiveIntensity={0.15} />
      </mesh>
      {/* Flag head at the top of the pole. */}
      <mesh position={[0, POLE_HEIGHT, 0]}>
        <sphereGeometry args={[0.12, 20, 20]} />
        <meshStandardMaterial color={selected ? "#facc15" : "#7dd3a8"} emissive="#7dd3a8" emissiveIntensity={0.4} />
      </mesh>
      <Html distanceFactor={9} position={[0, POLE_HEIGHT + 0.25, 0]}>
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
  sceneName,
  plants,
  selectedPlantId,
  onSelectPlant,
  onPlacePlant,
}: GardenSceneEditorProps) {
  return (
    <div className="h-[520px] w-full overflow-hidden rounded-[2rem] border border-white/10 bg-[#020a07]">
      <Canvas camera={{ position: [6, 6, 6], fov: 50 }} dpr={[1, 2]}>
        <color attach="background" args={["#081b14"]} />
        <fog attach="fog" args={["#081b14", 18, 52]} />
        <ambientLight intensity={1.8} color="#f3fff8" />
        <hemisphereLight intensity={1.9} color="#f3fff8" groundColor="#163125" />
        <directionalLight position={[8, 12, 6]} intensity={3.4} color="#ffffff" />
        <directionalLight position={[-10, 8, -6]} intensity={2.2} color="#d7ffe7" />
        <pointLight position={[-8, 6, -6]} intensity={1.8} color="#86efac" />
        <pointLight position={[0, 5, 10]} intensity={1.4} color="#d9fff0" />

        <gridHelper args={[40, 40, "#1f7a52", "#123525"]} position={[0, 0, 0]} />
        <PlacementSurface onPlacePlant={onPlacePlant} />

        <Suspense fallback={null}>
          {sceneUrl ? (
            <SceneModel url={sceneUrl} name={sceneName} onPlacePlant={onPlacePlant} />
          ) : null}
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