type StartupDetails = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN =
  /authorization|token|jwt|secret|password|credential/i;

declare global {
  interface Window {
    __TEAM9_STARTUP_T0?: number;
  }
}

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function isStartupProfilerEnabled() {
  if (typeof window === "undefined") return false;

  const override = window.localStorage?.getItem("team9_startup_debug");
  if (override === "0") return false;
  if (override === "1") return true;

  return import.meta.env.DEV || IS_TAURI;
}

function getStartupT0() {
  if (typeof window === "undefined") return 0;

  if (typeof window.__TEAM9_STARTUP_T0 !== "number") {
    window.__TEAM9_STARTUP_T0 = performance.now();
  }

  return window.__TEAM9_STARTUP_T0;
}

export function startupNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function startupDurationMs(startedAt: number) {
  return Math.round((startupNow() - startedAt) * 10) / 10;
}

function sanitizeDetails(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeDetails);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeDetails(entry),
      ]),
    );
  }

  if (
    typeof value === "string" &&
    (value.startsWith("Bearer ") || value.split(".").length === 3)
  ) {
    return "[redacted]";
  }

  return value;
}

function formatDetails(details: StartupDetails) {
  try {
    return JSON.stringify(sanitizeDetails(details));
  } catch {
    return "[details unavailable]";
  }
}

export function markStartup(label: string, details?: StartupDetails) {
  if (!isStartupProfilerEnabled()) return;

  const delta = startupDurationMs(getStartupT0());
  const message = `[startup] +${delta.toFixed(1)}ms ${label}`;

  if (details && Object.keys(details).length > 0) {
    console.info(`${message} ${formatDetails(details)}`);
  } else {
    console.info(message);
  }
}

export async function measureStartup<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = startupNow();
  markStartup(`${label}:start`);

  try {
    const result = await operation();
    markStartup(`${label}:end`, {
      durationMs: startupDurationMs(startedAt),
    });
    return result;
  } catch (error) {
    markStartup(`${label}:error`, {
      durationMs: startupDurationMs(startedAt),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function getStartupPathForLog(url: string) {
  try {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "http://local";
    const parsed = new URL(url, origin);
    return parsed.pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}
