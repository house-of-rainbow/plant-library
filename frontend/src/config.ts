// Runtime app configuration.
//
// In the container, /config.js is generated at startup from environment
// variables (see the frontend Dockerfile entrypoint) and sets
// window.__APP_CONFIG__. During local `vite dev`, public/config.js provides a
// dev default (auth disabled). import.meta.env is used as a final fallback.

export interface AppConfig {
  authDisabled: boolean;
  entraClientId: string;
  entraTenantId: string;
  entraApiScope: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>;
  }
}

const runtime: Partial<AppConfig> =
  (typeof window !== "undefined" && window.__APP_CONFIG__) || {};

export const appConfig: AppConfig = {
  authDisabled:
    runtime.authDisabled ?? import.meta.env.VITE_AUTH_DISABLED === "true",
  entraClientId: runtime.entraClientId || import.meta.env.VITE_ENTRA_CLIENT_ID || "",
  entraTenantId:
    runtime.entraTenantId || import.meta.env.VITE_ENTRA_TENANT_ID || "common",
  entraApiScope: runtime.entraApiScope || import.meta.env.VITE_ENTRA_API_SCOPE || "",
};
