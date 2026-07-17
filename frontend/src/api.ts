import axios from "axios";
import type {
  CareDefaults,
  CareEvent,
  DashboardSummary,
  EventType,
  Garden,
  GardenScene,
  HealthStatus,
  MemberRole,
  Membership,
  PlantClass,
  PlantInstance,
  Position3D,
  Property,
  SunlightLevel,
  Tag,
  TagScope,
} from "./types";

const baseURL = import.meta.env.VITE_API_BASE_URL || "";

export const http = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

// Attach bearer token when auth is enabled (token provider set by auth layer).
let tokenProvider: (() => Promise<string | null>) | null = null;
export function setTokenProvider(fn: () => Promise<string | null>) {
  tokenProvider = fn;
}

http.interceptors.request.use(async (config) => {
  if (tokenProvider) {
    const token = await tokenProvider();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth headers for non-axios calls (e.g. fetch streaming).
export async function authHeaders(): Promise<Record<string, string>> {
  if (tokenProvider) {
    const token = await tokenProvider();
    if (token) return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export const apiBaseUrl = baseURL;

export interface PersonalAccessTokenCreated {
  id: string;
  name?: string | null;
  last_four: string;
  expires_at: string;
  last_used_at?: string | null;
  created_at: string;
  token: string;
}

// ---- Properties / Gardens / Members (tenancy) ----
export interface PropertyCreate {
  name: string;
  address?: string;
  home_garden_name?: string;
}

export interface GardenCreate {
  name: string;
  description?: string;
  is_home?: boolean;
}

export const propertiesApi = {
  list: () => http.get<Property[]>("/api/properties").then((r) => r.data),
  get: (id: string) => http.get<Property>(`/api/properties/${id}`).then((r) => r.data),
  create: (payload: PropertyCreate) =>
    http.post<Property>("/api/properties", payload).then((r) => r.data),
  update: (id: string, payload: { name?: string; address?: string }) =>
    http.patch<Property>(`/api/properties/${id}`, payload).then((r) => r.data),
  remove: (id: string) => http.delete(`/api/properties/${id}`).then((r) => r.data),
};

export const gardensApi = {
  list: (propertyId: string) =>
    http.get<Garden[]>(`/api/properties/${propertyId}/gardens`).then((r) => r.data),
  sceneUrl: (propertyId: string, gardenId: string) =>
    `${apiBaseUrl}/api/properties/${propertyId}/gardens/${gardenId}/scene`,
  create: (propertyId: string, payload: GardenCreate) =>
    http
      .post<Garden>(`/api/properties/${propertyId}/gardens`, payload)
      .then((r) => r.data),
  update: (
    propertyId: string,
    gardenId: string,
    payload: { name?: string; description?: string; scene?: GardenScene | null }
  ) =>
    http
      .patch<Garden>(`/api/properties/${propertyId}/gardens/${gardenId}`, payload)
      .then((r) => r.data),
  uploadScene: async (propertyId: string, gardenId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await http.post<Garden>(
      `/api/properties/${propertyId}/gardens/${gardenId}/scene`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return data;
  },
  remove: (propertyId: string, gardenId: string) =>
    http
      .delete(`/api/properties/${propertyId}/gardens/${gardenId}`)
      .then((r) => r.data),
};

export const membersApi = {
  list: (propertyId: string) =>
    http
      .get<Membership[]>(`/api/properties/${propertyId}/members`)
      .then((r) => r.data),
  add: (propertyId: string, payload: { email: string; role: MemberRole }) =>
    http
      .post<Membership>(`/api/properties/${propertyId}/members`, payload)
      .then((r) => r.data),
  updateRole: (propertyId: string, memberId: string, role: MemberRole) =>
    http
      .patch<Membership>(
        `/api/properties/${propertyId}/members/${memberId}`,
        { role }
      )
      .then((r) => r.data),
  remove: (propertyId: string, memberId: string) =>
    http
      .delete(`/api/properties/${propertyId}/members/${memberId}`)
      .then((r) => r.data),
};

export const patsApi = {
  list: () => http.get<string[]>("/api/auth/pats").then((r) => r.data),
  create: () =>
    http
      .post<PersonalAccessTokenCreated>("/api/auth/pats", {})
      .then((r) => r.data),
  remove: (tokenId: string) =>
    http.delete(`/api/auth/pats/${tokenId}`).then((r) => r.data),
};

// ---- Tags ----
export interface TagCreate {
  name: string;
  color?: string | null;
  scope?: TagScope;
  garden_id?: string | null;
}

export const tagsApi = {
  list: (propertyId: string, params?: { garden_id?: string; scope?: TagScope }) =>
    http
      .get<Tag[]>(`/api/properties/${propertyId}/tags`, { params })
      .then((r) => r.data),
  create: (propertyId: string, payload: TagCreate) =>
    http
      .post<Tag>(`/api/properties/${propertyId}/tags`, payload)
      .then((r) => r.data),
  update: (propertyId: string, tagId: string, payload: Partial<TagCreate>) =>
    http
      .patch<Tag>(`/api/properties/${propertyId}/tags/${tagId}`, payload)
      .then((r) => r.data),
  remove: (propertyId: string, tagId: string) =>
    http.delete(`/api/properties/${propertyId}/tags/${tagId}`).then((r) => r.data),
  apply: (propertyId: string, tagId: string, instanceIds: string[]) =>
    http
      .post(`/api/properties/${propertyId}/tags/${tagId}/apply`, {
        instance_ids: instanceIds,
      })
      .then((r) => r.data),
  removeFromPlants: (propertyId: string, tagId: string, instanceIds: string[]) =>
    http
      .post(`/api/properties/${propertyId}/tags/${tagId}/remove`, {
        instance_ids: instanceIds,
      })
      .then((r) => r.data),
  runAction: (
    propertyId: string,
    tagId: string,
    payload: { type: EventType; notes?: string; treatment?: string; new_health_status?: HealthStatus }
  ) =>
    http
      .post<{ affected: number }>(
        `/api/properties/${propertyId}/tags/${tagId}/action`,
        payload
      )
      .then((r) => r.data),
};

// ---- Plant classes ----
export const classesApi = {
  list: (propertyId: string) =>
    http
      .get<PlantClass[]>("/api/classes", { params: { property_id: propertyId } })
      .then((r) => r.data),
  get: (propertyId: string, id: string) =>
    http
      .get<PlantClass>(`/api/classes/${id}`, { params: { property_id: propertyId } })
      .then((r) => r.data),
  create: (propertyId: string, payload: Partial<PlantClass>) =>
    http
      .post<PlantClass>("/api/classes", payload, {
        params: { property_id: propertyId },
      })
      .then((r) => r.data),
  update: (propertyId: string, id: string, payload: Partial<PlantClass>) =>
    http
      .patch<PlantClass>(`/api/classes/${id}`, payload, {
        params: { property_id: propertyId },
      })
      .then((r) => r.data),
  remove: (propertyId: string, id: string) =>
    http
      .delete(`/api/classes/${id}`, { params: { property_id: propertyId } })
      .then((r) => r.data),
};

// ---- Plant instances ----
export interface InstanceCreate {
  class_id: string;
  garden_id: string;
  nickname?: string;
  location?: string;
  position_3d?: Position3D | null;
  acquisition_date?: string;
  pot_size?: string;
  soil_type?: string;
  health_status?: HealthStatus;
  care_overrides?: CareDefaults;
  image_urls?: string[];
  tag_ids?: string[];
  notes?: string;
}

export const instancesApi = {
  list: (
    propertyId: string,
    filters?: { garden_id?: string; class_id?: string; tag_id?: string }
  ) =>
    http
      .get<PlantInstance[]>("/api/instances", {
        params: { property_id: propertyId, ...filters },
      })
      .then((r) => r.data),
  get: (propertyId: string, id: string) =>
    http
      .get<PlantInstance>(`/api/instances/${id}`, {
        params: { property_id: propertyId },
      })
      .then((r) => r.data),
  create: (propertyId: string, payload: InstanceCreate) =>
    http
      .post<PlantInstance>("/api/instances", payload, {
        params: { property_id: propertyId },
      })
      .then((r) => r.data),
  update: (propertyId: string, id: string, payload: Partial<InstanceCreate>) =>
    http
      .patch<PlantInstance>(`/api/instances/${id}`, payload, {
        params: { property_id: propertyId },
      })
      .then((r) => r.data),
  remove: (propertyId: string, id: string) =>
    http
      .delete(`/api/instances/${id}`, { params: { property_id: propertyId } })
      .then((r) => r.data),
  addEvent: (
    propertyId: string,
    id: string,
    payload: { type: EventType; notes?: string; treatment?: string; new_health_status?: HealthStatus }
  ) =>
    http
      .post<PlantInstance>(`/api/instances/${id}/events`, payload, {
        params: { property_id: propertyId },
      })
      .then((r) => r.data),
};

// ---- Scan ----
export const scanApi = {
  resolve: (plantId: string) =>
    http.get<PlantInstance>(`/api/scan/${plantId}`).then((r) => r.data),
  qrUrl: (plantId: string) => `${baseURL}/api/scan/${plantId}/qr.png`,
};

// ---- Images ----
export const imagesApi = {
  upload: async (file: File): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await http.post<{ url: string }>("/api/images", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data.url;
  },
};

// ---- Dashboard ----
export const dashboardApi = {
  summary: (propertyId: string, gardenId?: string) =>
    http
      .get<DashboardSummary>("/api/dashboard/summary", {
        params: { property_id: propertyId, garden_id: gardenId },
      })
      .then((r) => r.data),
};

// ---- Identify (Pl@ntNet) ----
export interface PetToxicity {
  matched: boolean;
  source_url?: string | null;
  matched_scientific_name?: string | null;
  matched_common_name?: string | null;
  dogs: "toxic" | "non_toxic" | "unknown";
  cats: "toxic" | "non_toxic" | "unknown";
  horses: "toxic" | "non_toxic" | "unknown";
  toxic_principles?: string | null;
  clinical_signs?: string | null;
  severity?: string;
  label_level: "safe" | "caution" | "toxic" | "danger" | "unknown";
  toxic_to_pets?: boolean | null;
  summary?: string;
}

export interface IdentifyCandidate {
  scientific_name: string;
  scientific_name_without_author?: string | null;
  common_name?: string | null;
  common_names: string[];
  genus?: string | null;
  family?: string | null;
  score: number;
  description?: string | null;
  watering_interval_days?: number | null;
  watering_notes?: string | null;
  sunlight?: SunlightLevel | null;
  light_notes?: string | null;
  fertilizing_interval_days?: number | null;
  fertilizer_type?: string | null;
  fertilizer_notes?: string | null;
  repotting_interval_months?: number | null;
  soil_type?: string | null;
  pot_size?: string | null;
  hardiness_zone?: string | null;
  mature_size?: string | null;
  pruning_notes?: string | null;
  propagation_notes?: string | null;
  pests_notes?: string | null;
  toxic_to_pets?: boolean | null;
  care_notes?: string | null;
  reference_url?: string | null;
  gbif_id?: string | null;
  powo_id?: string | null;
  image_url?: string | null;
  agreed_by_both?: boolean | null;
  note?: string | null;
  pet_toxicity?: PetToxicity | null;
}

export interface IdentifyResponse {
  best_match?: string | null;
  remaining_requests?: number | null;
  source?: string | null;
  candidates: IdentifyCandidate[];
}

export type IdentifyStep = "start" | "plantnet" | "openai" | "consolidate" | "toxicity" | "enrich" | "complete";
export type IdentifyStepStatus = "running" | "done" | "error" | "skipped";

export interface IdentifyStreamEvent {
  step: IdentifyStep;
  status?: IdentifyStepStatus;
  count?: number;
  candidates?: IdentifyCandidate[];
  summary?: string | null;
  source?: string;
  engines?: { plantnet: boolean; openai: boolean };
}

export const identifyApi = {
  identify: async (
    files: File[],
    promptContext?: string
  ): Promise<IdentifyResponse> => {
    const form = new FormData();
    files.forEach((f) => form.append("images", f));
    if (promptContext?.trim()) form.append("prompt_context", promptContext.trim());
    const { data } = await http.post<IdentifyResponse>("/api/identify", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },

  // Ensemble identify with live progress (newline-delimited JSON stream).
  identifyStream: async (
    files: File[],
    promptContext: string | undefined,
    onEvent: (e: IdentifyStreamEvent) => void
  ): Promise<void> => {
    const form = new FormData();
    files.forEach((f) => form.append("images", f));
    if (promptContext?.trim()) form.append("prompt_context", promptContext.trim());
    const headers = await authHeaders();
    const resp = await fetch(`${baseURL}/api/identify/stream`, {
      method: "POST",
      body: form,
      headers,
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`Identify failed (${resp.status})`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const raw = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (raw) onEvent(JSON.parse(raw) as IdentifyStreamEvent);
      }
    }
    const tail = buf.trim();
    if (tail) onEvent(JSON.parse(tail) as IdentifyStreamEvent);
  },
};

export type { CareEvent };
