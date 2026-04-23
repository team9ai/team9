// Must come before anything that can touch innerHTML — registers Trusted
// Types policies for the CSP report-only header advertised by the server.
import "./lib/trusted-types";
import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { ErrorFallback } from "./components/error-fallback";
// KaTeX CSS must load BEFORE global.css so our overrides in global.css
// (.katex font-size, .katex-display margin) win via later source position —
// both sides define same-specificity rules.
import "katex/dist/katex.min.css";
import "./global.css";
import "./i18n";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./lib/query-client";
import { Team9PostHogProvider } from "./analytics/posthog";

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

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const AppProviders = ({ children }: { children: React.ReactNode }) => {
  let tree = children;

  tree = <Team9PostHogProvider>{tree}</Team9PostHogProvider>;

  if (googleClientId) {
    tree = (
      <GoogleOAuthProvider clientId={googleClientId}>
        {tree}
      </GoogleOAuthProvider>
    );
  }

  return <>{tree}</>;
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
