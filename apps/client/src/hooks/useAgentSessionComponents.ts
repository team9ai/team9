import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import imApi from "@/services/api/im";
import { API_BASE_URL } from "@/constants/api-base-url";
import { getValidAccessToken, redirectToLogin } from "@/services/auth-session";
import type {
  ComponentDataSnapshotEvent,
  SafeSessionComponentItem,
  SafeSessionComponentsResponse,
} from "@/types/im";

export function agentSessionComponentsKey(
  channelId: string | null | undefined,
) {
  return ["channel-agent-session-components", channelId] as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshotEvent(value: unknown): value is ComponentDataSnapshotEvent {
  if (!isRecord(value)) return false;
  return (
    value.type === "component_data_snapshot" &&
    typeof value.sessionId === "string" &&
    typeof value.timestamp === "number" &&
    typeof value.turnIndex === "number" &&
    Array.isArray(value.components) &&
    value.components.every(
      (component) =>
        isRecord(component) &&
        typeof component.componentId === "string" &&
        isRecord(component.data),
    )
  );
}

function patchComponents(
  current: SafeSessionComponentsResponse | undefined,
  event: ComponentDataSnapshotEvent,
): { next: SafeSessionComponentsResponse | undefined; hasUnknown: boolean } {
  if (!current) return { next: current, hasUnknown: false };
  if (current.sessionId !== event.sessionId) {
    return { next: current, hasUnknown: false };
  }

  let hasUnknown = false;
  const byId = new Map(
    current.components.map((component) => [component.id, component]),
  );

  for (const update of event.components) {
    const existing = byId.get(update.componentId);
    const latestData = {
      data: update.data,
      capturedAtCallId: null,
      capturedAt: event.timestamp,
    };

    if (existing) {
      byId.set(update.componentId, { ...existing, latestData });
    } else {
      hasUnknown = true;
      byId.set(update.componentId, {
        id: update.componentId,
        typeKey: update.componentId,
        runtimeInjectedOnly: true,
        latestData,
      } satisfies SafeSessionComponentItem);
    }
  }

  return {
    next: { ...current, components: Array.from(byId.values()) },
    hasUnknown,
  };
}

export function useAgentSessionComponents(
  channelId: string | null | undefined,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => agentSessionComponentsKey(channelId),
    [channelId],
  );
  const isEnabled = enabled && !!channelId;

  const query = useQuery({
    queryKey,
    queryFn: () =>
      imApi.channels.getAgentSessionComponents(channelId as string),
    enabled: isEnabled,
    retry: false,
  });

  useEffect(() => {
    if (!isEnabled || !channelId) return;

    let source: EventSource | null = null;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const open = async () => {
      const token = await getValidAccessToken();
      if (!token) {
        if (!disposed) redirectToLogin();
        return;
      }
      if (disposed) return;

      source = new EventSource(
        `${API_BASE_URL}/v1/im/channels/${encodeURIComponent(
          channelId,
        )}/agent-session/events?token=${encodeURIComponent(token)}`,
      );
      source.onopen = () => {
        void queryClient.invalidateQueries({ queryKey });
      };
      const handleMessage = (message: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(message.data) as unknown;
          if (!isSnapshotEvent(parsed)) return;

          let shouldRefetch = false;
          queryClient.setQueryData<SafeSessionComponentsResponse>(
            queryKey,
            (current) => {
              const patched = patchComponents(current, parsed);
              shouldRefetch = patched.hasUnknown;
              return patched.next;
            },
          );
          if (shouldRefetch) {
            void queryClient.invalidateQueries({ queryKey });
          }
        } catch {
          // Ignore heartbeats and malformed records.
        }
      };
      source.onmessage = handleMessage;
      source.addEventListener(
        "component_data_snapshot",
        handleMessage as EventListener,
      );
      source.onerror = () => {
        if (disposed || reconnectTimer) return;
        source?.close();
        source = null;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void open();
        }, 2_000);
      };
    };

    void open();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [channelId, isEnabled, queryClient, queryKey]);

  return query;
}
