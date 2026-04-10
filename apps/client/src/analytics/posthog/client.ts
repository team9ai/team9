import type { PostHog } from "posthog-js";
import { posthogBrowserConfig, TEAM9_APP_VERSION } from "./config";

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let posthogClientPromise: Promise<PostHog | null> | null = null;

export const getPostHogBrowserClient = (): Promise<PostHog | null> => {
  const config = posthogBrowserConfig;

  if (!config) {
    return Promise.resolve(null);
  }

  if (!posthogClientPromise) {
    posthogClientPromise = import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(config.key, {
          api_host: config.host,
          defaults: "2026-01-30",
          cross_subdomain_cookie: !IS_TAURI,
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          capture_dead_clicks: false,
          capture_exceptions: false,
          capture_heatmaps: false,
          disable_external_dependency_loading: true,
          disable_session_recording: true,
          disable_surveys: true,
          advanced_disable_flags: true,
          advanced_disable_toolbar_metrics: true,
          mask_all_element_attributes: true,
          mask_all_text: true,
          debug: import.meta.env.DEV,
        });

        posthog.register({
          app_name: "team9-app",
          app_version: TEAM9_APP_VERSION,
          app_platform: IS_TAURI ? "desktop" : "web",
        });

        return posthog;
      })
      .catch((error) => {
        console.error("[PostHog] Failed to initialize browser client", error);
        posthogClientPromise = null;
        return null;
      });
  }

  return posthogClientPromise;
};
