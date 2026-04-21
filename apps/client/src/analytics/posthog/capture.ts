// apps/client/src/analytics/posthog/capture.ts
import type { PostHog } from "posthog-js";
import { GTM_BRIDGE_EVENTS } from "./events";

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

/**
 * Capture an event to PostHog and mirror selected conversion events to
 * window.dataLayer so GTM can forward them to ad platforms.
 */
export function captureWithBridge(
  client: PostHog | null,
  event: string,
  properties?: Record<string, unknown>,
): void {
  client?.capture(event, properties);

  const gtmEvent = GTM_BRIDGE_EVENTS[event];
  if (gtmEvent && typeof window !== "undefined") {
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ event: gtmEvent, ...properties });
  }
}
