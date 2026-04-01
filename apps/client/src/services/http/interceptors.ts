import * as Sentry from "@sentry/react";
import type { HttpRequestConfig, HttpResponse, HttpError } from "./types";
import { useWorkspaceStore } from "../../stores";
import {
  getAuthToken,
  redirectToLogin,
  refreshAccessToken,
} from "../auth-session";

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
  const token = getAuthToken();

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

export const handleUnauthorized = async (
  error: HttpError,
): Promise<HttpResponse | never> => {
  if (error.status !== 401) {
    throw error;
  }

  const originalConfig = error.config;

  // Avoid retry loops for the refresh endpoint itself.
  if (originalConfig?.url?.includes("/v1/auth/refresh")) {
    redirectToLogin();
    throw error;
  }

  try {
    const newToken = await refreshAccessToken();

    if (!newToken) {
      redirectToLogin();
      throw error;
    }

    if (originalConfig) {
      return await retryRequest(originalConfig, newToken);
    }

    throw error;
  } catch {
    redirectToLogin();
    throw error;
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
