import type { HttpError } from "@/services/http/types";

interface ErrorResponseBody {
  message?: string;
}

function isHttpError(error: unknown): error is HttpError<ErrorResponseBody> {
  return (
    error instanceof Error &&
    ("status" in error || "response" in error || "code" in error)
  );
}

export function getHttpErrorMessage(error: unknown): string | undefined {
  if (isHttpError(error)) {
    const responseMessage = error.response?.data?.message;
    if (typeof responseMessage === "string" && responseMessage.length > 0) {
      return responseMessage;
    }
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return undefined;
}

export function getHttpErrorStatus(error: unknown): number | undefined {
  if (!isHttpError(error)) return undefined;
  return error.response?.status ?? error.status;
}
