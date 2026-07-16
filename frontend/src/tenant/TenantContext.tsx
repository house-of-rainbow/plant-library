import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { propertiesApi } from "../api";
import type { Garden, MemberRole, Property } from "../types";

const PROP_KEY = "pl.propertyId";
const GARDEN_KEY = "pl.gardenId";

interface TenantContextValue {
  properties: Property[];
  isLoading: boolean;
  hasProperties: boolean;
  property: Property | null;
  propertyId: string | null;
  gardens: Garden[];
  garden: Garden | null;
  gardenId: string | null;
  role: MemberRole | null;
  isOwner: boolean;
  setPropertyId: (id: string) => void;
  setGardenId: (id: string | null) => void;
  refresh: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data: properties = [], isLoading } = useQuery({
    queryKey: ["properties"],
    queryFn: propertiesApi.list,
  });

  const [propertyId, setPropertyIdState] = useState<string | null>(
    () => localStorage.getItem(PROP_KEY)
  );
  const [gardenId, setGardenIdState] = useState<string | null>(
    () => localStorage.getItem(GARDEN_KEY)
  );

  // Keep the selected property valid as the list loads/changes.
  useEffect(() => {
    if (isLoading || properties.length === 0) return;
    const valid = properties.some((p) => p.id === propertyId);
    if (!valid) {
      setPropertyIdState(properties[0].id);
    }
  }, [isLoading, properties, propertyId]);

  const property = useMemo(
    () => properties.find((p) => p.id === propertyId) ?? null,
    [properties, propertyId]
  );

  const gardens = property?.gardens ?? [];

  // Keep the selected garden valid within the current property.
  useEffect(() => {
    if (!property) return;
    if (gardens.length === 0) {
      if (gardenId !== null) setGardenIdState(null);
      return;
    }
    const valid = gardenId && gardens.some((g) => g.id === gardenId);
    if (!valid) {
      const home = gardens.find((g) => g.is_home) ?? gardens[0];
      setGardenIdState(home.id);
    }
  }, [property, gardens, gardenId]);

  useEffect(() => {
    if (propertyId) localStorage.setItem(PROP_KEY, propertyId);
  }, [propertyId]);
  useEffect(() => {
    if (gardenId) localStorage.setItem(GARDEN_KEY, gardenId);
    else localStorage.removeItem(GARDEN_KEY);
  }, [gardenId]);

  const setPropertyId = useCallback((id: string) => {
    setPropertyIdState(id);
    setGardenIdState(null); // reset garden; effect re-selects the home garden
  }, []);

  const setGardenId = useCallback((id: string | null) => {
    setGardenIdState(id);
  }, []);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["properties"] });
  }, [qc]);

  const garden = useMemo(
    () => gardens.find((g) => g.id === gardenId) ?? null,
    [gardens, gardenId]
  );

  const value: TenantContextValue = {
    properties,
    isLoading,
    hasProperties: properties.length > 0,
    property,
    propertyId: property?.id ?? null,
    gardens,
    garden,
    gardenId: garden?.id ?? null,
    role: property?.role ?? null,
    isOwner: property?.role === "owner",
    setPropertyId,
    setGardenId,
    refresh,
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within a TenantProvider");
  return ctx;
}

/** Convenience hook that asserts an active property (for scoped pages). */
export function useActiveProperty(): { propertyId: string; gardenId: string | null } {
  const { propertyId, gardenId } = useTenant();
  if (!propertyId) throw new Error("No active property selected");
  return { propertyId, gardenId };
}
