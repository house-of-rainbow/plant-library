import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { appConfig } from "./config";
import { setTokenProvider } from "./api";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } },
});

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
}

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById("root")!);

  // Local / auth-disabled mode: render directly, no login required.
  if (appConfig.authDisabled) {
    root.render(
      <React.StrictMode>
        <Providers>
          <App />
        </Providers>
      </React.StrictMode>
    );
    return;
  }

  // Authenticated mode: force EntraID sign-in (redirect) before anything renders.
  const [{ MsalProvider, MsalAuthenticationTemplate }, { InteractionType }, { msalInstance, loginRequest }] =
    await Promise.all([
      import("@azure/msal-react"),
      import("@azure/msal-browser"),
      import("./auth/msal"),
    ]);

  await msalInstance.initialize();
  await msalInstance.handleRedirectPromise();

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
  }

  // Supply access tokens to the API client.
  setTokenProvider(async () => {
    const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
    if (!account) return null;
    try {
      const result = await msalInstance.acquireTokenSilent({ ...loginRequest, account });
      return result.accessToken;
    } catch {
      // Silent acquisition failed (e.g. consent/interaction required).
      await msalInstance.acquireTokenRedirect(loginRequest);
      return null;
    }
  });

  root.render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <MsalAuthenticationTemplate
          interactionType={InteractionType.Redirect}
          authenticationRequest={loginRequest}
        >
          <Providers>
            <App />
          </Providers>
        </MsalAuthenticationTemplate>
      </MsalProvider>
    </React.StrictMode>
  );
}

void bootstrap();
