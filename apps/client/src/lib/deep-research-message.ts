import type { Message } from "@/types/im";

export interface DeepResearchMessagePayload {
  taskId: string;
  version: 1;
  origin?: "dashboard" | "chat";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function buildDeepResearchMessageMetadata(
  taskId: string,
  origin: DeepResearchMessagePayload["origin"] = "dashboard",
): Record<string, unknown> {
  return {
    deepResearch: {
      taskId,
      version: 1,
      origin,
    } satisfies DeepResearchMessagePayload,
  };
}

export function getDeepResearchMessagePayload(
  metadata: Message["metadata"] | Record<string, unknown> | null | undefined,
): DeepResearchMessagePayload | null {
  if (!isRecord(metadata)) return null;

  const raw = metadata.deepResearch;
  if (!isRecord(raw)) return null;
  if (typeof raw.taskId !== "string" || raw.taskId.length === 0) return null;

  return {
    taskId: raw.taskId,
    version: 1,
    origin:
      raw.origin === "dashboard" || raw.origin === "chat"
        ? raw.origin
        : undefined,
  };
}

export function getDeepResearchTaskId(
  metadata: Message["metadata"] | Record<string, unknown> | null | undefined,
): string | null {
  return getDeepResearchMessagePayload(metadata)?.taskId ?? null;
}
