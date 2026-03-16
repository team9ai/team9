import { useConnectionStore } from "@/stores/connection";
import { useEventStore } from "@/stores/events";
import { generateId } from "@/lib/utils";
import type { DebugEvent } from "@/lib/types";

function getBaseUrl(): string {
  return useConnectionStore.getState().serverUrl.replace(/\/$/, "") + "/api";
}

function getAuthHeaders(): HeadersInit {
  const token = useConnectionStore.getState().token;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function recordRestEvent(
  method: string,
  path: string,
  body: unknown,
  response: unknown,
  status: number,
): void {
  const event: DebugEvent = {
    id: generateId(),
    timestamp: Date.now(),
    direction: "out",
    eventName: `REST:${method} ${path}`,
    payload: { request: body, response, status },
    meta: {
      size: JSON.stringify(body ?? "").length,
    },
  };
  useEventStore.getState().addEvent(event);
}

export async function sendMessage(
  channelId: string,
  content: string,
  parentId?: string,
): Promise<unknown> {
  const path = `/v1/im/channels/${channelId}/messages`;
  const body = { content, parentId };

  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });

  const data = await res
    .json()
    .catch(() => ({ error: "Failed to parse response" }));
  recordRestEvent("POST", path, body, data, res.status);
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function getChannels(): Promise<unknown> {
  const path = "/v1/im/channels";
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: getAuthHeaders(),
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function getUser(userId: string): Promise<unknown> {
  const path = `/v1/im/users/${userId}`;
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: getAuthHeaders(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}
