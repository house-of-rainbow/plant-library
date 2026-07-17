import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useNavigate, useParams } from "react-router-dom";
import { gardensApi, instancesApi } from "../api";
import GardenSceneEditor from "../three/GardenSceneEditor";
import { useTenant } from "../tenant/TenantContext";
import type { PlantInstance, Position3D } from "../types";

function formatPosition(position: Position3D | null | undefined): string {
  if (!position) {
    return "Not placed";
  }
  return `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`;
}

export default function GardenSceneEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { propertyId, gardens, garden: activeGarden, setGardenId, refresh, isOwner } = useTenant();
  const garden = useMemo(() => gardens.find((item) => item.id === id) ?? null, [gardens, id]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const hasAutoSelected = useRef(false);

  useEffect(() => {
    if (garden && garden.id !== activeGarden?.id) {
      setGardenId(garden.id);
    }
  }, [activeGarden?.id, garden, setGardenId]);

  useEffect(() => {
    setName(garden?.name ?? "");
    setDescription(garden?.description ?? "");
  }, [garden?.description, garden?.name, garden?.id]);

  const { data: plants = [], isLoading } = useQuery({
    queryKey: ["instances", propertyId, id],
    queryFn: () => instancesApi.list(propertyId!, { garden_id: id }),
    enabled: !!propertyId && !!id,
  });

  const orderedPlants = useMemo(() => {
    return [...plants].sort((left, right) => {
      const leftPlaced = left.position_3d ? 1 : 0;
      const rightPlaced = right.position_3d ? 1 : 0;
      if (leftPlaced !== rightPlaced) {
        return leftPlaced - rightPlaced;
      }
      const leftLabel = left.nickname || left.plant_class?.common_name || "";
      const rightLabel = right.nickname || right.plant_class?.common_name || "";
      return leftLabel.localeCompare(rightLabel);
    });
  }, [plants]);

  useEffect(() => {
    if (!orderedPlants.length) {
      setSelectedPlantId(null);
      return;
    }
// Drop the selection if the selected plant no longer exists.
    if (selectedPlantId && !orderedPlants.some((plant) => plant.id === selectedPlantId)) {
      setSelectedPlantId(null);
      return;
    }

    // Auto-select a plant once on first load for convenience. After that,
    // selection (including deselecting) is fully user-controlled so clicking
    // the map only moves a plant when one is intentionally selected.
    if (!hasAutoSelected.current && !selectedPlantId) {
      const next = orderedPlants.find((plant) => !plant.position_3d) ?? orderedPlants[0];
      setSelectedPlantId(next.id);
      hasAutoSelected.current = true;
    }
  }, [orderedPlants, selectedPlantId]);

  const selectedPlant = orderedPlants.find((plant) => plant.id === selectedPlantId) ?? null;
  const sceneUrl = propertyId && garden?.scene ? gardensApi.sceneUrl(propertyId, garden.id) : null;

  const saveGarden = useMutation({
    mutationFn: () =>
      gardensApi.update(propertyId!, id!, {
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: async () => {
      await refresh();
      qc.invalidateQueries({ queryKey: ["properties"] });
    },
  });

  const uploadScene = useMutation({
    mutationFn: (file: File) => gardensApi.uploadScene(propertyId!, id!, file),
    onSuccess: async () => {
      await refresh();
      qc.invalidateQueries({ queryKey: ["properties"] });
    },
  });

  const clearScene = useMutation({
    mutationFn: () => gardensApi.update(propertyId!, id!, { scene: null }),
    onSuccess: async () => {
      await refresh();
      qc.invalidateQueries({ queryKey: ["properties"] });
    },
  });

  const savePosition = useMutation({
    mutationFn: ({ plantId, position }: { plantId: string; position: Position3D }) =>
      instancesApi.update(propertyId!, plantId, { position_3d: position }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const clearPosition = useMutation({
    mutationFn: (plantId: string) => instancesApi.update(propertyId!, plantId, { position_3d: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  function handlePlacePlant(position: Position3D) {
    if (!selectedPlant) {
      return;
    }
    savePosition.mutate({ plantId: selectedPlant.id, position });
  }

  if (!propertyId || !id || !garden) {
    return (
      <div className="glass p-8 space-y-4">
        <h1 className="font-display text-3xl font-bold">Garden not found</h1>
        <p className="text-white/60">
          Select a garden from the property switcher, then reopen the scene editor.
        </p>
        <button className="btn-primary" onClick={() => navigate("/")}>Back to dashboard</button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <button className="text-sm text-canopy-300 hover:text-canopy-200" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1 className="font-display text-3xl font-bold mt-2">{garden.name} scene editor</h1>
          <p className="text-white/55 max-w-3xl">
            Upload an optional Polycam 3D export, then select a plant and click anywhere in the scene to drop its pin.
          </p>
        </div>

        <div className="glass-soft px-4 py-3 text-sm text-white/70">
          <div>{garden.scene ? "Polycam scene loaded" : "No Polycam scene yet"}</div>
          <div>{orderedPlants.filter((plant) => plant.position_3d).length} of {orderedPlants.length} plants placed</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <div className="space-y-4">
          <div className="glass p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold">3D map</h2>
                <p className="text-sm text-white/50">
                  {selectedPlant
                    ? `Selected plant: ${selectedPlant.nickname || selectedPlant.plant_class?.common_name || "Plant"}`
                    : "No plant selected — clicking the map won't move anything."}
                </p>
              </div>
              {savePosition.isPending && <span className="text-xs text-canopy-300">Saving position…</span>}
              {selectedPlant && (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setSelectedPlantId(null)}
                >
                  Deselect
                </button>
              )}
            </div>

            <GardenSceneEditor
              sceneUrl={sceneUrl}
              sceneName={garden.scene?.model_filename}
              plants={orderedPlants}
              selectedPlantId={selectedPlantId}
              onSelectPlant={setSelectedPlantId}
              onPlacePlant={handlePlacePlant}
            />
          </div>

          <motion.div layout className="glass p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold">Garden details</h2>
                <p className="text-sm text-white/50">The 3D map is optional and stored on the garden object.</p>
              </div>
              {isOwner && (
                <button
                  className="btn-primary"
                  disabled={saveGarden.isPending || !name.trim()}
                  onClick={() => saveGarden.mutate()}
                >
                  {saveGarden.isPending ? "Saving…" : "Save garden"}
                </button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!isOwner}
                />
              </div>
              <div>
                <label className="label">Polycam scene file</label>
                {isOwner ? (
                  <input
                    type="file"
                    accept=".glb,.fbx,.obj,.stl,.dae"
                    className="block w-full text-sm text-white/70"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        uploadScene.mutate(file);
                        event.currentTarget.value = "";
                      }
                    }}
                  />
                ) : (
                  <div className="input flex items-center text-white/45">Owner access required</div>
                )}
              </div>
            </div>

            <div>
              <label className="label">Description</label>
              <textarea
                className="input min-h-[96px]"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!isOwner}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-white/55">
              <span>
                {garden.scene?.model_filename ? `Current file: ${garden.scene.model_filename}` : "No scene file uploaded"}
              </span>
              <span>Best results: Polycam FBX. Single-file GLB/OBJ/STL/DAE also work.</span>
              {garden.scene && isOwner && (
                <button className="btn-ghost" onClick={() => clearScene.mutate()} disabled={clearScene.isPending}>
                  {clearScene.isPending ? "Removing…" : "Remove scene"}
                </button>
              )}
              {uploadScene.isPending && <span className="text-canopy-300">Uploading scene…</span>}
            </div>
          </motion.div>
        </div>

        <div className="glass p-5 space-y-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Plants in this garden</h2>
            <p className="text-sm text-white/50">
              Choose a plant, then click the model or grid to place its pin.
            </p>
          </div>

          {isLoading ? (
            <p className="text-white/50">Loading plants…</p>
          ) : orderedPlants.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-white/55">
              This garden has no plants yet.
            </div>
          ) : (
            <div className="space-y-3">
              {orderedPlants.map((plant: PlantInstance) => {
                const label = plant.nickname || plant.plant_class?.common_name || "Plant";
                const imageUrl = plant.image_urls[0];
                const selected = plant.id === selectedPlantId;

                return (
                  <div
                    key={plant.id}
                    className={`w-full rounded-[1.5rem] border p-3 transition-colors ${
                      selected
                        ? "border-canopy-300/60 bg-canopy-400/10"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedPlantId(selected ? null : plant.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start gap-3">
                      {imageUrl ? (
                        <img src={imageUrl} alt={label} className="h-14 w-14 rounded-2xl object-cover" />
                      ) : (
                        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-2xl">🌿</div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate font-semibold">{label}</div>
                          <span className="text-[11px] uppercase tracking-wide text-white/35">
                            {plant.position_3d ? "Placed" : "Unplaced"}
                          </span>
                        </div>
                        <div className="truncate text-sm text-white/45">
                          {plant.plant_class?.common_name || "Unknown species"}
                        </div>
                        <div className="mt-2 text-xs text-white/55">
                          {formatPosition(plant.position_3d)}
                        </div>
                      </div>
                      </div>
                    </button>

                    <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                      <span className="text-white/45">
                        {selected ? "Click the scene to place. Click again to deselect." : "Select to place its pin."}
                      </span>
                      {plant.position_3d && (
                        <button
                          type="button"
                          className="text-red-200 hover:text-red-100"
                          onClick={() => clearPosition.mutate(plant.id)}
                        >
                          Clear pin
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}