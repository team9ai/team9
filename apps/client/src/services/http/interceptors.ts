import type { HttpRequestConfig, HttpResponse, HttpError } from "./types";

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

export const handleUnauthorized = async (error: HttpError): Promise<never> => {
  if (error.status === 401) {
    // Clear all auth tokens on 401
    localStorage.removeItem("auth_token");
    localStorage.removeItem("refresh_token");
    window.location.href = "/login";
  }
  throw error;
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
