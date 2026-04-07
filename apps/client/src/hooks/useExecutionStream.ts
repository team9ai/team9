import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getValidAccessToken, redirectToLogin } from "@/services/auth-session";
import { API_BASE_URL } from "@/constants/api-base-url";

/**
 * Opens an SSE connection to the TaskCast proxy for a specific execution.
 * Invalidates React Query caches when events arrive.
 *
 * `taskcastTaskId` is used as a boolean gate — if null/undefined, TaskCast
 * was not set up for this execution and no SSE connection is opened.
 * The actual TaskCast ID is computed server-side from the execId (deterministic).
 */
export function useExecutionStream(
  routineId: string,
  execId: string | undefined,
  taskcastTaskId: string | null | undefined,
  enabled: boolean,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !execId || !taskcastTaskId) return;

    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let reconnecting = false;

    const handleMessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data);

        // Invalidate relevant caches based on event type
        if (
          data.type === "step" ||
          data.type === "intervention" ||
          data.type === "deliverable"
        ) {
          queryClient.invalidateQueries({
            queryKey: ["routine-execution-entries", routineId, execId],
          });
        }

        // Status change events invalidate the task and execution queries
        if (data.type === "status_changed") {
          queryClient.invalidateQueries({ queryKey: ["routine", routineId] });
          queryClient.invalidateQueries({
            queryKey: ["routine-executions", routineId],
          });
          queryClient.invalidateQueries({
            queryKey: ["routine-execution", routineId, execId],
          });
        }
      } catch {
        // Ignore parse errors (e.g. heartbeat messages)
      }
    };

    const openStream = async (token?: string) => {
      const accessToken = token ?? (await getValidAccessToken());
      if (!accessToken) {
        if (!disposed) {
          redirectToLogin();
        }
        return;
      }

      if (disposed) {
        return;
      }

      const url = `${API_BASE_URL}/v1/routines/${routineId}/executions/${execId}/stream?token=${encodeURIComponent(accessToken)}`;
      eventSource = new EventSource(url);
      eventSource.onmessage = handleMessage;
      eventSource.onerror = () => {
        if (disposed || reconnecting) {
          return;
        }

        reconnecting = true;
        eventSource?.close();
        eventSource = null;

        void (async () => {
          const nextToken = await getValidAccessToken();
          if (!nextToken) {
            if (!disposed) {
              redirectToLogin();
            }
            return;
          }

          if (disposed) {
            return;
          }

          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            reconnecting = false;
            void openStream(nextToken);
          }, 1000);
        })();
      };
    };

    void openStream();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      eventSource?.close();
    };
  }, [routineId, execId, taskcastTaskId, enabled, queryClient]);
}
