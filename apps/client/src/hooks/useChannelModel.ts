import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import wsService from "@/services/websocket";
import type { ChannelModelChangedEvent } from "@/types/ws-events";
import { getValidAccessToken } from "@/services/auth-session";
import { API_BASE_URL } from "@/constants/api-base-url";

export interface ChannelModelState {
  model: { provider: string; id: string };
  source: "agent_default" | "session_initial" | "dynamic";
  override: { provider: string; id: string } | null;
}

/**
 * Session-level model controller for a DM / routine-session channel.
 *
 * Flow:
 *  - On mount: GET /v1/im/channels/:id/model (useQuery).
 *  - While mounted: listen for push updates through two parallel channels —
 *      1. Socket.io `channel_model_changed` (team9's own fanout, fires
 *         immediately after a successful PATCH from any device)
 *      2. Server-Sent Events proxy `/v1/im/channels/:id/model-stream` that
 *         forwards agent-pi's `agent.model_change` events (covers future
 *         agent-initiated switches)
 *    Both paths hydrate the same React Query cache, so whichever arrives
 *    first wins and the UI stays consistent.
 *  - updateModel(...) → PATCH /v1/im/channels/:id/model
 *
 * Returns `null` for `data` when the channel is not eligible (e.g. group
 * chat or no managed-hive bot) — the request 403s and the hook surfaces
 * `isError: true`.
 */
export function useChannelModel(
  channelId: string | null,
  options?: { enabled?: boolean },
) {
  const enabled = (options?.enabled ?? true) && !!channelId;
  const queryClient = useQueryClient();
  // Memoized so the useEffect deps below have a stable reference across
  // renders (otherwise the SSE/WS subscriptions would tear down every render).
  const queryKey = useMemo(
    () => ["channel-model", channelId] as const,
    [channelId],
  );

  const query = useQuery<ChannelModelState>({
    queryKey,
    queryFn: async () => {
      const r = await api.im.channels.getChannelModel(channelId as string);
      return { model: r.model, source: r.source, override: r.override };
    },
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: async (model: { provider: string; id: string }) => {
      if (!channelId) throw new Error("channelId is required");
      const r = await api.im.channels.updateChannelModel(channelId, model);
      return { model: r.model, source: r.source, override: r.override };
    },
    onSuccess: (next) => {
      queryClient.setQueryData<ChannelModelState>(queryKey, next);
    },
  });

  // Socket.io listener — reflects any team9-initiated change, including
  // ones made on another device by the same user.
  useEffect(() => {
    if (!enabled || !channelId) return;
    const handler = (event: ChannelModelChangedEvent) => {
      if (event.channelId !== channelId) return;
      queryClient.setQueryData<ChannelModelState>(queryKey, {
        model: event.model,
        source: event.source,
        override: event.source === "agent_default" ? null : event.model,
      });
    };
    wsService.onChannelModelChanged(handler);
    return () => {
      wsService.off("channel_model_changed", handler);
    };
  }, [enabled, channelId, queryClient, queryKey]);

  // SSE bridge to agent-pi — covers non-team9-initiated changes (e.g.
  // an agent using the `change_model` tool on itself). Idle-session
  // behavior depends on agent-pi's internals; if the stream is silent
  // the Socket.io listener above still covers user-initiated changes.
  useEffect(() => {
    if (!enabled || !channelId) return;
    let es: EventSource | null = null;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const open = async () => {
      if (disposed) return;
      const token = await getValidAccessToken();
      if (!token || disposed) return;
      const url = `${API_BASE_URL}/v1/im/channels/${channelId}/model-stream?token=${encodeURIComponent(
        token,
      )}`;
      es = new EventSource(url);
      es.onopen = () => {
        // Close the "initial GET → SSE subscribe" gap: a model change that
        // happened while the stream was connecting would be invisible to
        // both the stale snapshot and the as-yet-unopened stream. Refetch
        // as soon as we know we're live.
        void queryClient.invalidateQueries({ queryKey });
      };
      es.onmessage = (ev: MessageEvent<string>) => {
        try {
          // agent-core emits `{ type: "model_change", fromModel, toModel, ... }`
          // via its event bus — see agent-pi/packages/agent-core/src/agent-session.ts:1318.
          // The gateway's filterSseRecord forwards it unchanged (see
          // apps/server/.../channel-model.controller.ts).
          const data = JSON.parse(ev.data) as {
            type?: string;
            toModel?: { provider: string; id: string };
          };
          if (data.type !== "model_change" || !data.toModel) return;
          queryClient.setQueryData<ChannelModelState>(queryKey, {
            model: data.toModel,
            source: "dynamic",
            override: data.toModel,
          });
        } catch {
          /* ignore heartbeats / unparseable records */
        }
      };
      es.onerror = () => {
        if (disposed) return;
        es?.close();
        es = null;
        // Refetch the GET endpoint on disconnect to resync state that
        // may have changed during the gap (SSE has no replay).
        void queryClient.invalidateQueries({ queryKey });
        reconnectTimer = setTimeout(() => void open(), 2_000);
      };
    };

    void open();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [enabled, channelId, queryClient, queryKey]);

  return {
    ...query,
    updateModel: (model: { provider: string; id: string }) =>
      mutation.mutateAsync(model),
    isUpdating: mutation.isPending,
  };
}
