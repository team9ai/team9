import { nanoid } from "nanoid";

export function generateId(): string {
  return nanoid(12);
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function extractChannelId(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "channelId" in payload
  ) {
    return (payload as Record<string, unknown>).channelId as string;
  }
  return undefined;
}

export function extractStreamId(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "streamId" in payload
  ) {
    return (payload as Record<string, unknown>).streamId as string;
  }
  return undefined;
}

export function extractUserId(payload: unknown): string | undefined {
  if (typeof payload === "object" && payload !== null) {
    const p = payload as Record<string, unknown>;
    return (p.senderId ?? p.userId) as string | undefined;
  }
  return undefined;
}
