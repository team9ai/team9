import { api } from "@/services/api";

export const MODEL_CHANGE_POLL_INTERVAL_MS = 1_000;
export const MODEL_CHANGE_MAX_POLLS = 180;

export class ModelChangeFailedError extends Error {
  constructor(
    readonly code: string,
    message = "Model change failed",
  ) {
    super(message);
    this.name = "ModelChangeFailedError";
  }
}

export function createModelChangeIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `model-change-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isUnsupportedModelError(error: unknown): boolean {
  if (
    error instanceof ModelChangeFailedError &&
    error.code === "unsupported_model"
  ) {
    return true;
  }
  const code = (
    error as {
      response?: { data?: { code?: unknown } };
    }
  )?.response?.data?.code;
  return code === "unsupported_model";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForModelChangeAttempt(
  attemptId: string,
  options: {
    intervalMs?: number;
    maxPolls?: number;
  } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? MODEL_CHANGE_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? MODEL_CHANGE_MAX_POLLS;

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const attempt = await api.im.modelChanges.getAttempt(attemptId);
    if (attempt.state === "dispatched") return;
    if (attempt.state === "failed" || attempt.state === "rejected") {
      throw new ModelChangeFailedError(
        attempt.safeErrorCode ?? attempt.reasonCode ?? attempt.state,
      );
    }
    await delay(intervalMs);
  }
  throw new ModelChangeFailedError("model_change_timeout");
}
