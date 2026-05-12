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
import { channelAgentSessionKey } from "./useChannelAgentSession";

export function agentSessionComponentsKey(
  channelId: string | null | undefined,
  sessionId?: string | null,
) {
  return [
    "channel-agent-session-components",
    channelId,
    sessionId ?? null,
  ] as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnData(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, "data");
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
        hasOwnData(component) &&
        component.data !== undefined,
    )
  );
}

function patchComponents(
  current: SafeSessionComponentsResponse | undefined,
  event: ComponentDataSnapshotEvent,
): {
  next: SafeSessionComponentsResponse | undefined;
  hasUnknown: boolean;
  isStaleSession: boolean;
} {
  if (!current) {
    return { next: current, hasUnknown: false, isStaleSession: false };
  }
  if (current.sessionId !== event.sessionId) {
    return { next: current, hasUnknown: false, isStaleSession: true };
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
    isStaleSession: false,
  };
}

export function useAgentSessionComponents(
  channelId: string | null | undefined,
  enabled = true,
  sessionId?: string | null,
) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => agentSessionComponentsKey(channelId, sessionId),
    [channelId, sessionId],
  );
  const isEnabled = enabled && !!channelId && !!sessionId;

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
    let shouldForceRefresh = false;
    let lastEventId: string | null = null;

    const open = async () => {
      const token = shouldForceRefresh
        ? await getValidAccessToken({ forceRefresh: true })
        : await getValidAccessToken();
      shouldForceRefresh = false;
      if (!token) {
        if (!disposed) redirectToLogin();
        return;
      }
      if (disposed) return;

      const params = new URLSearchParams({ token });
      if (lastEventId) params.set("lastEventId", lastEventId);
      source = new EventSource(
        `${API_BASE_URL}/v1/im/channels/${encodeURIComponent(
          channelId,
        )}/agent-session/events?${params.toString()}`,
      );
      source.onopen = () => {
        void queryClient.invalidateQueries({ queryKey });
      };
      const handleMessage = (message: MessageEvent<string>) => {
        if (message.lastEventId) lastEventId = message.lastEventId;
        try {
          const parsed = JSON.parse(message.data) as unknown;
          if (!isSnapshotEvent(parsed)) return;

          let shouldRefetch = false;
          let isStaleSession = false;
          queryClient.setQueryData<SafeSessionComponentsResponse>(
            queryKey,
            (current) => {
              const patched = patchComponents(current, parsed);
              shouldRefetch = patched.hasUnknown || patched.isStaleSession;
              isStaleSession = patched.isStaleSession;
              return patched.next;
            },
          );
          if (shouldRefetch) {
            void queryClient.invalidateQueries({ queryKey });
          }
          if (isStaleSession) {
            void queryClient.invalidateQueries({
              queryKey: channelAgentSessionKey(channelId),
            });
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
        shouldForceRefresh = true;
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
