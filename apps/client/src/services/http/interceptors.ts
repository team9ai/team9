import * as Sentry from "@sentry/react";
import type { HttpRequestConfig, HttpResponse, HttpError } from "./types";
import { useWorkspaceStore } from "../../stores";
import {
  getValidAccessToken,
  redirectToLogin,
  refreshAccessToken,
} from "../auth-session";
import { API_BASE_URL } from "@/constants/api-base-url";

function parseRequestData(data: unknown): Record<string, unknown> | null {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data) as unknown;
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)
    : null;
}

function hasDataEnvelope(value: unknown): value is { data: unknown } {
  return typeof value === "object" && value !== null && "data" in value;
}

function getRequestPath(config: HttpRequestConfig) {
  const url = config.url ?? "";

  try {
    const base = config.baseURL ?? API_BASE_URL;
    return new URL(url, base).pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function summarizeBody(data: unknown): string {
  if (data === undefined || data === null) {
    return "none";
  }

  if (data instanceof FormData) {
    return "FormData";
  }

  if (typeof data === "string") {
    return `string(${data.length})`;
  }

  if (Array.isArray(data)) {
    return `Array(${data.length})`;
  }

  if (typeof data === "object") {
    const keys = Object.keys(data);
    return `Object(${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",..." : ""})`;
  }

  return typeof data;
}

function summarizeResponseData(data: unknown): string {
  if (hasDataEnvelope(data)) {
    return `Envelope(${summarizeResponseData(data.data)})`;
  }

  return summarizeBody(data);
}

function sanitizeHeaders(headers: HeadersInit | undefined) {
  const source = new Headers(headers);
  const sanitized: Record<string, string> = {};

  source.forEach((value, key) => {
    sanitized[key] =
      key.toLowerCase() === "authorization" ? "[redacted]" : value;
  });

  return sanitized;
}

export const requestLogger = (config: HttpRequestConfig): HttpRequestConfig => {
  if (import.meta.env.DEV) {
    console.log("[HTTP Request]", {
      method: config.method,
      path: getRequestPath(config),
      params: config.params,
      body: summarizeBody(config.data),
      headers: sanitizeHeaders(config.headers),
    });
  }
  return config;
};

export const responseLogger = <T>(
  response: HttpResponse<T>,
): HttpResponse<T> => {
  if (import.meta.env.DEV) {
    console.log("[HTTP Response]", {
      status: response.status,
      statusText: response.statusText,
      path: getRequestPath(response.config),
      data: summarizeResponseData(response.data),
    });
  }
  return response;
};

export const errorLogger = async (error: HttpError): Promise<never> => {
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
      path: error.config ? getRequestPath(error.config) : undefined,
      response: summarizeResponseData(error.response?.data),
    });
  }
  throw error;
};

export const authInterceptor = async (
  config: HttpRequestConfig,
): Promise<HttpRequestConfig> => {
  const token = await getValidAccessToken();

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
  } else if (import.meta.env.DEV) {
    console.warn(`[HTTP Interceptor] No workspace selected for request`);
  }

  return config;
};

const retryRequest = async <T = unknown>(
  config: HttpRequestConfig,
  newToken: string,
): Promise<HttpResponse<T>> => {
  let url = config.baseURL
    ? `${config.baseURL}${config.url || ""}`
    : `${API_BASE_URL}${config.url || ""}`;

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, config.timeout ?? 30000);

  const response = await fetch(url, {
    method: config.method || "GET",
    headers,
    body,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });

  const data = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? ((await response.json()) as T)
    : ((await response.text()) as T);

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
  const isRefreshRequest =
    originalConfig?.url?.includes("/v1/auth/refresh") ||
    (originalConfig?.data &&
      parseRequestData(originalConfig.data)?.refreshToken);

  if (isRefreshRequest) {
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
  if (response.data && hasDataEnvelope(response.data)) {
    return {
      ...response,
      data: response.data.data as T,
    };
  }
  return response;
};
