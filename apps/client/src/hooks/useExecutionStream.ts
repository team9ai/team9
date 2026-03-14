import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

/**
 * Opens an SSE connection to the TaskCast proxy for a specific execution.
 * Invalidates React Query caches when events arrive.
 *
 * `taskcastTaskId` is used as a boolean gate — if null/undefined, TaskCast
 * was not set up for this execution and no SSE connection is opened.
 * The actual TaskCast ID is computed server-side from the execId (deterministic).
 */
export function useExecutionStream(
  taskId: string,
  execId: string | undefined,
  taskcastTaskId: string | null | undefined,
  enabled: boolean,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !execId || !taskcastTaskId) return;

    const token = localStorage.getItem("auth_token");
    if (!token) return;

    const url = `${API_BASE_URL}/v1/tasks/${taskId}/executions/${execId}/stream?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Invalidate relevant caches based on event type
        if (
          data.type === "step" ||
          data.type === "intervention" ||
          data.type === "deliverable"
        ) {
          queryClient.invalidateQueries({
            queryKey: ["task-execution-entries", taskId, execId],
          });
        }

        // Status change events invalidate the task and execution queries
        if (data.type === "status_changed") {
          queryClient.invalidateQueries({ queryKey: ["task", taskId] });
          queryClient.invalidateQueries({
            queryKey: ["task-executions", taskId],
          });
          queryClient.invalidateQueries({
            queryKey: ["task-execution", taskId, execId],
          });
        }
      } catch {
        // Ignore parse errors (e.g. heartbeat messages)
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects on error; no action needed.
    };

    return () => eventSource.close();
  }, [taskId, execId, taskcastTaskId, enabled, queryClient]);
}
