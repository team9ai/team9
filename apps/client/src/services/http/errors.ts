import type { HttpError } from "./types";

function getMessageFromData(data: unknown): string | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof data.message === "string"
  ) {
    return data.message;
  }

  return null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const getErrorMessage = (
  error: unknown,
  fallback = "An unexpected error occurred",
): string => {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (isHttpError(error)) {
    return getMessageFromData(error.response?.data) || error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }

  return fallback;
};

export const isHttpError = (error: unknown): error is HttpError => {
  return (
    error instanceof Error &&
    "config" in error &&
    ("status" in error || "code" in error)
  );
};

export const handleApiError = (error: HttpError): ApiError => {
  const message = getMessageFromData(error.response?.data) || error.message;
  const statusCode = error.status;
  const code = error.code;
  const data = error.response?.data;

  return new ApiError(message, statusCode, code, data);
};

export const errorMessages: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized - Please login again",
  403: "Forbidden",
  404: "Resource not found",
  405: "Method not allowed",
  408: "Request timeout",
  500: "Internal server error",
  502: "Bad gateway",
  503: "Service unavailable",
  504: "Gateway timeout",
};

export const getStatusMessage = (status: number): string => {
  return errorMessages[status] || `Request failed (${status})`;
};
