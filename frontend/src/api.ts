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

// Auth headers for non-axios calls (e.g. fetch streaming).
export async function authHeaders(): Promise<Record<string, string>> {
  if (tokenProvider) {
    const token = await tokenProvider();
    if (token) return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export const apiBaseUrl = baseURL;

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

export type IdentifyStep = "start" | "plantnet" | "openai" | "consolidate" | "toxicity" | "complete";
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
  identify: async (files: File[]): Promise<IdentifyResponse> => {
    const form = new FormData();
    files.forEach((f) => form.append("images", f));
    const { data } = await http.post<IdentifyResponse>("/api/identify", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },

  // Ensemble identify with live progress (newline-delimited JSON stream).
  identifyStream: async (
    files: File[],
    onEvent: (e: IdentifyStreamEvent) => void
  ): Promise<void> => {
    const form = new FormData();
    files.forEach((f) => form.append("images", f));
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
