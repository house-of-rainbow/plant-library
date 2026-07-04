import { PublicClientApplication } from "@azure/msal-browser";
import type { Configuration, RedirectRequest } from "@azure/msal-browser";
import { appConfig } from "../config";

const configuration: Configuration = {
  auth: {
    clientId: appConfig.entraClientId,
    authority: `https://login.microsoftonline.com/${appConfig.entraTenantId}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

export const msalInstance = new PublicClientApplication(configuration);

// Scope requested for both interactive login and silent API-token acquisition.
export const loginRequest: RedirectRequest = {
  scopes: appConfig.entraApiScope ? [appConfig.entraApiScope] : [],
};
