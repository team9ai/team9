// apps/client/src/analytics/posthog/acquisition.ts
import type { PostHog } from "posthog-js";

const UTM_PARAMS = [
  ["utm_source", "acquisition_source"],
  ["utm_medium", "acquisition_medium"],
  ["utm_campaign", "acquisition_campaign"],
  ["utm_content", "acquisition_content"],
  ["utm_term", "acquisition_term"],
] as const;

// When utm_source follows the convention "<medium>-<campaign>" (e.g. "reddit-smb1"),
// split on the first hyphen to derive medium and campaign. Explicit utm_medium /
// utm_campaign in the URL always win over the derived values.
function deriveFromSource(source: string): {
  medium?: string;
  campaign?: string;
} {
  const sepIdx = source.indexOf("-");
  if (sepIdx <= 0 || sepIdx === source.length - 1) return {};
  return {
    medium: source.slice(0, sepIdx),
    campaign: source.slice(sepIdx + 1),
  };
}

/**
 * Capture UTM parameters from the current URL and persist them to the
 * PostHog person as $set_once (i.e. first-touch attribution).
 *
 * Safe to call on every app start — PostHog de-dupes via $set_once.
 * On Tauri desktop URL has no UTM params; this is a no-op.
 */
export function captureAcquisitionOnce(client: PostHog): void {
  if (typeof window === "undefined") return;

  const search = new URLSearchParams(window.location.search);
  const setOnce: Record<string, string> = {};

  for (const [urlKey, propKey] of UTM_PARAMS) {
    const value = search.get(urlKey);
    if (value) {
      setOnce[propKey] = value;
    }
  }

  const source = search.get("utm_source");
  if (source) {
    const { medium, campaign } = deriveFromSource(source);
    if (medium && !setOnce.acquisition_medium) {
      setOnce.acquisition_medium = medium;
    }
    if (campaign && !setOnce.acquisition_campaign) {
      setOnce.acquisition_campaign = campaign;
    }
  }

  if (Object.keys(setOnce).length > 0) {
    client.setPersonProperties(undefined, setOnce);
  }
}
