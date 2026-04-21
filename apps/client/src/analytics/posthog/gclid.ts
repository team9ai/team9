import type { PostHog } from "posthog-js";

const COOKIE_NAME = "gclid";
// Google Ads retains a gclid for 90 days; match that as the cookie lifetime.
const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

function getCookieDomain(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const host = window.location.hostname;
  if (host === "team9.ai" || host.endsWith(".team9.ai")) return ".team9.ai";
  return undefined;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
  ];
  const domain = getCookieDomain();
  if (domain) parts.push(`Domain=${domain}`);
  if (window.location.protocol === "https:") parts.push("Secure");
  document.cookie = parts.join("; ");
}

/**
 * Persist Google Ads click ID for conversion reporting.
 *
 * URL param wins over cookie so a newer click supersedes an older one. The
 * cookie is scoped to `.team9.ai` so it survives navigation, Google OAuth
 * redirects, and the hop from team9.ai (homepage) to app.team9.ai (app).
 *
 * The PostHog Google Ads destination reads
 * `person.properties.gclid ?? person.properties.$initial_gclid`, so we set
 * both. `register` also attaches `gclid` as a super property to every
 * subsequent event for funnel analysis.
 *
 * Desktop (Tauri) has no URL query and no cookie from a prior web hop, so this
 * safely no-ops there.
 */
export function captureGclid(client: PostHog): void {
  if (typeof window === "undefined") return;

  const urlValue = new URLSearchParams(window.location.search).get("gclid");
  const gclid = urlValue || readCookie(COOKIE_NAME);
  if (!gclid) return;

  if (urlValue) writeCookie(COOKIE_NAME, urlValue);

  client.register({ gclid });
  client.setPersonProperties({ gclid }, { $initial_gclid: gclid });
}
