const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

const posthogKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
const posthogHost =
  import.meta.env.VITE_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST;
export { TEAM9_APP_VERSION } from "@/constants/app-version";

export interface Team9PostHogBrowserConfig {
  key: string;
  host: string;
}

export const posthogBrowserConfig: Team9PostHogBrowserConfig | null = posthogKey
  ? {
      key: posthogKey,
      host: posthogHost,
    }
  : null;

export const isPostHogBrowserEnabled = posthogBrowserConfig !== null;
