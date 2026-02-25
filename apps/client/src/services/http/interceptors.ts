import * as Sentry from "@sentry/react";
import type { HttpRequestConfig, HttpResponse, HttpError } from "./types";
import { useWorkspaceStore } from "../../stores";

// Token refresh management
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

const subscribeTokenRefresh = (callback: (token: string) => void) => {
  refreshSubscribers.push(callback);
};

const onTokenRefreshed = (newToken: string) => {
  refreshSubscribers.forEach((callback) => callback(newToken));
  refreshSubscribers = [];
};

const onRefreshFailed = () => {
  refreshSubscribers = [];
};

// Directly call refresh API using fetch to avoid circular dependency
const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken = localStorage.getItem("refresh_token");

  if (!refreshToken) {
    return null;
  }

  try {
    const baseURL =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";
    const response = await fetch(`${baseURL}/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    // Update stored tokens
    localStorage.setItem("auth_token", data.accessToken);
    localStorage.setItem("refresh_token", data.refreshToken);

    return data.accessToken;
  } catch {
    return null;
  }
};

export const requestLogger = (config: HttpRequestConfig): HttpRequestConfig => {
  if (import.meta.env.DEV) {
    console.log(`[HTTP Request] ${config.method} ${config.baseURL}`, config);
  }
  return config;
};

export const responseLogger = <T>(
  response: HttpResponse<T>,
): HttpResponse<T> => {
  if (import.meta.env.DEV) {
    console.log(
      `[HTTP Response] ${response.status} ${response.statusText}`,
      response.data,
    );
  }
  return response;
};

export const errorLogger = async (error: HttpError): Promise<never> => {
  // Report to Sentry (skip 401 as those are handled by auth refresh)
  if (error.status !== 401) {
    Sentry.captureException(error, {
      tags: {
        url: error.config?.url,
        method: error.config?.method,
        status: error.status?.toString(),
      },
    });
  }

  if (import.meta.env.DEV) {
    console.error("[HTTP Error]", {
      message: error.message,
      status: error.status,
      code: error.code,
      response: error.response?.data,
    });
  }
  throw error;
};

export const authInterceptor = (
  config: HttpRequestConfig,
): HttpRequestConfig => {
  const token = localStorage.getItem("auth_token");

  if (token) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    };
  }

  return config;
};

export const workspaceInterceptor = (
  config: HttpRequestConfig,
): HttpRequestConfig => {
  const workspaceId = useWorkspaceStore.getState().selectedWorkspaceId;

  if (workspaceId) {
    config.headers = {
      ...config.headers,
      "X-Tenant-Id": workspaceId,
    };
    if (import.meta.env.DEV) {
      console.log(`[HTTP Interceptor] Adding X-Tenant-Id: ${workspaceId}`);
    }
  } else {
    if (import.meta.env.DEV) {
      console.warn(`[HTTP Interceptor] No workspace selected for request`);
    }
  }

  return config;
};

// Retry a failed request with new token
const retryRequest = async (
  config: HttpRequestConfig,
  newToken: string,
): Promise<HttpResponse> => {
  const baseURL =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

  // Build the full URL
  let url = config.baseURL
    ? `${config.baseURL}${config.url || ""}`
    : `${baseURL}${config.url || ""}`;

  // Handle params if present
  if (config.params) {
    const urlObj = new URL(url);
    Object.entries(config.params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        urlObj.searchParams.append(key, String(value));
      }
    });
    url = urlObj.toString();
  }

  const headers = new Headers(config.headers as HeadersInit);
  headers.set("Authorization", `Bearer ${newToken}`);

  let body: string | FormData | undefined;
  if (config.data) {
    if (config.data instanceof FormData) {
      body = config.data;
      headers.delete("Content-Type");
    } else {
      body = JSON.stringify(config.data);
    }
  }

  const response = await fetch(url, {
    method: config.method || "GET",
    headers,
    body,
  });

  const contentType = response.headers.get("content-type");
  let data: any;

  if (contentType?.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const error = new Error(
      `Request failed with status ${response.status}`,
    ) as HttpError;
    error.status = response.status;
    error.config = config;
    throw error;
  }

  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    config,
  };
};

const redirectToLogin = () => {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("refresh_token");

  // Don't redirect if already on auth pages (login, register, verify-email)
  const authPaths = ["/login", "/register", "/verify-email"];
  const currentPath = window.location.pathname;
  if (authPaths.some((path) => currentPath.startsWith(path))) {
    return;
  }

  window.location.href = "/login";
};

export const handleUnauthorized = async (
  error: HttpError,
): Promise<HttpResponse | never> => {
  if (error.status !== 401) {
    throw error;
  }

  const originalConfig = error.config;

  // Check if this is already a refresh token request to avoid infinite loop
  if (originalConfig?.data) {
    const data =
      typeof originalConfig.data === "string"
        ? JSON.parse(originalConfig.data)
        : originalConfig.data;
    if (data.refreshToken) {
      // Refresh token request itself failed, redirect to login
      redirectToLogin();
      throw error;
    }
  }

  // If already refreshing, wait for the refresh to complete
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      subscribeTokenRefresh(async (newToken: string) => {
        try {
          if (originalConfig) {
            const response = await retryRequest(originalConfig, newToken);
            resolve(response);
          } else {
            reject(error);
          }
        } catch (retryError) {
          reject(retryError);
        }
      });
    });
  }

  // Start refreshing
  isRefreshing = true;

  try {
    const newToken = await refreshAccessToken();

    if (!newToken) {
      // Refresh failed, redirect to login
      onRefreshFailed();
      redirectToLogin();
      throw error;
    }

    // Notify all waiting requests
    onTokenRefreshed(newToken);

    // Retry the original request
    if (originalConfig) {
      return await retryRequest(originalConfig, newToken);
    }

    throw error;
  } catch (refreshError) {
    onRefreshFailed();
    redirectToLogin();
    throw error;
  } finally {
    isRefreshing = false;
  }
};

export const transformResponse = <T>(
  response: HttpResponse<T>,
): HttpResponse<T> => {
  if (
    response.data &&
    typeof response.data === "object" &&
    "data" in response.data
  ) {
    return {
      ...response,
      data: (response.data as any).data,
    };
  }
  return response;
};
