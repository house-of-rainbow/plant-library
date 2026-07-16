import type { Garden, PlantInstance, Property } from "../types";

export function formatPlantLocation(
  plant: PlantInstance,
  property: Property | null,
  gardens: Garden[]
): string {
  const manual = (plant.location ?? "").trim();
  if (manual) return manual;

  if (!property || property.id !== plant.property_id) {
    return "—";
  }

  const garden = gardens.find((item) => item.id === plant.garden_id);
  return garden ? `${property.name} / ${garden.name}` : property.name;
}