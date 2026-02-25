import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import TagManager from "react-gtm-module";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { ErrorFallback } from "./components/error-fallback";
import "./global.css";
import "./i18n";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./lib/query-client";

// Initialize Sentry
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});

// Initialize Google Tag Manager
const gtmId = import.meta.env.VITE_GTM_ID;
if (gtmId) {
  TagManager.initialize({ gtmId });
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const AppProviders = ({ children }: { children: React.ReactNode }) => {
  if (googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        {children}
      </GoogleOAuthProvider>
    );
  }
  return <>{children}</>;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <QueryClientProvider client={queryClient}>
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
