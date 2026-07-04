import axios from "axios";
import type {
  CareDefaults,
  CareEvent,
  DashboardSummary,
  EventType,
  HealthStatus,
  PlantClass,
  PlantInstance,
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

// ---- Plant classes ----
export const classesApi = {
  list: () => http.get<PlantClass[]>("/api/classes").then((r) => r.data),
  get: (id: string) => http.get<PlantClass>(`/api/classes/${id}`).then((r) => r.data),
  create: (payload: Partial<PlantClass>) =>
    http.post<PlantClass>("/api/classes", payload).then((r) => r.data),
  update: (id: string, payload: Partial<PlantClass>) =>
    http.patch<PlantClass>(`/api/classes/${id}`, payload).then((r) => r.data),
  remove: (id: string) => http.delete(`/api/classes/${id}`).then((r) => r.data),
};

// ---- Plant instances ----
export interface InstanceCreate {
  class_id: string;
  nickname?: string;
  location?: string;
  acquisition_date?: string;
  pot_size?: string;
  soil_type?: string;
  health_status?: HealthStatus;
  care_overrides?: CareDefaults;
  image_urls?: string[];
  notes?: string;
}

export const instancesApi = {
  list: (classId?: string) =>
    http
      .get<PlantInstance[]>("/api/instances", {
        params: classId ? { class_id: classId } : undefined,
      })
      .then((r) => r.data),
  get: (id: string) =>
    http.get<PlantInstance>(`/api/instances/${id}`).then((r) => r.data),
  create: (payload: InstanceCreate) =>
    http.post<PlantInstance>("/api/instances", payload).then((r) => r.data),
  update: (id: string, payload: Partial<InstanceCreate>) =>
    http.patch<PlantInstance>(`/api/instances/${id}`, payload).then((r) => r.data),
  remove: (id: string) => http.delete(`/api/instances/${id}`).then((r) => r.data),
  addEvent: (
    id: string,
    payload: { type: EventType; notes?: string; treatment?: string; new_health_status?: HealthStatus }
  ) =>
    http
      .post<PlantInstance>(`/api/instances/${id}/events`, payload)
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
  summary: () =>
    http.get<DashboardSummary>("/api/dashboard/summary").then((r) => r.data),
};

// ---- Identify (Pl@ntNet) ----
export interface IdentifyCandidate {
  scientific_name: string;
  scientific_name_without_author?: string | null;
  common_name?: string | null;
  common_names: string[];
  genus?: string | null;
  family?: string | null;
  score: number;
  gbif_id?: string | null;
  powo_id?: string | null;
  image_url?: string | null;
}

export interface IdentifyResponse {
  best_match?: string | null;
  remaining_requests?: number | null;
  source?: string | null;
  candidates: IdentifyCandidate[];
}

export const identifyApi = {
  identify: async (files: File[]): Promise<IdentifyResponse> => {
    const form = new FormData();
    files.forEach((f) => form.append("images", f));
    const { data } = await http.post<IdentifyResponse>("/api/identify", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
};

export type { CareEvent };
