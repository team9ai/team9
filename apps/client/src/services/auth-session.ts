import { API_BASE_URL } from "@/constants/api-base-url";
import {
  markStartup,
  startupDurationMs,
  startupNow,
} from "@/lib/startup-profiler";

const AUTH_TOKEN_KEY = "auth_token";
const REFRESH_TOKEN_KEY = "refresh_token";
const LOGIN_PATHS = ["/login", "/register", "/verify-email"];
const ACCESS_TOKEN_EXPIRY_SKEW_SECONDS = 30;

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface JwtPayload {
  exp?: number;
}

let refreshPromise: Promise<string | null> | null = null;

const getApiBaseUrl = () => API_BASE_URL;

const decodeJwtPayload = (token: string): JwtPayload | null => {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }

    const normalized = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");

    return JSON.parse(atob(normalized)) as JwtPayload;
  } catch {
    return null;
  }
};

const isJwtExpired = (
  token: string,
  skewSeconds = ACCESS_TOKEN_EXPIRY_SKEW_SECONDS,
): boolean => {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + skewSeconds;
};

const requestTokenRefresh = async (): Promise<string | null> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    markStartup("auth.refresh:skipped", {
      reason: "missing refresh token",
    });
    return null;
  }

  const startedAt = startupNow();
  markStartup("auth.refresh:start");

  try {
    const response = await fetch(`${getApiBaseUrl()}/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      markStartup("auth.refresh:failed response", {
        status: response.status,
        durationMs: startupDurationMs(startedAt),
      });
      return null;
    }

    const data = (await response.json()) as Partial<TokenPair>;
    if (
      typeof data.accessToken !== "string" ||
      typeof data.refreshToken !== "string"
    ) {
      markStartup("auth.refresh:invalid payload", {
        durationMs: startupDurationMs(startedAt),
      });
      return null;
    }

    setAuthTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });

    markStartup("auth.refresh:end", {
      durationMs: startupDurationMs(startedAt),
    });
    return data.accessToken;
  } catch {
    markStartup("auth.refresh:network error", {
      durationMs: startupDurationMs(startedAt),
    });
    return null;
  }
};

export const getAuthToken = (): string | null =>
  localStorage.getItem(AUTH_TOKEN_KEY);

export const getRefreshToken = (): string | null =>
  localStorage.getItem(REFRESH_TOKEN_KEY);

export const hasStoredAuthSession = (): boolean =>
  !!getAuthToken() || !!getRefreshToken();

export const setAuthTokens = ({
  accessToken,
  refreshToken,
}: TokenPair): void => {
  localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
};

export const clearAuthTokens = (): void => {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
};

export const redirectToLogin = (): void => {
  clearAuthTokens();

  if (typeof window === "undefined") {
    return;
  }

  const currentPath = window.location.pathname;
  if (LOGIN_PATHS.some((path) => currentPath.startsWith(path))) {
    return;
  }

  window.location.href = "/login";
};

export const refreshAccessToken = async (): Promise<string | null> => {
  if (!refreshPromise) {
    refreshPromise = requestTokenRefresh().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
};

export const getValidAccessToken = async ({
  forceRefresh = false,
  minValiditySeconds = ACCESS_TOKEN_EXPIRY_SKEW_SECONDS,
}: {
  forceRefresh?: boolean;
  minValiditySeconds?: number;
} = {}): Promise<string | null> => {
  const token = getAuthToken();
  const hasToken = Boolean(token);
  const tokenExpired = token ? isJwtExpired(token, minValiditySeconds) : true;

  if (!forceRefresh && token && !tokenExpired) {
    return token;
  }

  markStartup("auth.accessToken:refresh needed", {
    forceRefresh,
    hasToken,
    tokenExpired,
    minValiditySeconds,
  });

  return refreshAccessToken();
};

export const isAuthTokenExpired = (
  token = getAuthToken(),
  skewSeconds = ACCESS_TOKEN_EXPIRY_SKEW_SECONDS,
): boolean => {
  if (!token) {
    return true;
  }

  return isJwtExpired(token, skewSeconds);
};
