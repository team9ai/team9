import { useEffect } from "react";
import { API_BASE_URL } from "@/constants/api-base-url";
import { getValidAccessToken, redirectToLogin } from "@/services/auth-session";
import { useAhandJobTelemetryStore } from "@/stores/useAhandJobTelemetryStore";

const JOB_EVENTS = [
  "job.stdout",
  "job.stderr",
  "job.progress",
  "job.finished",
  "job.error",
  "job.resync",
] as const;

type JobEventName = (typeof JOB_EVENTS)[number];

export function useAhandJobStream(
  hubJobId: string | undefined,
  deviceId: string | undefined,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !hubJobId || !deviceId) return;
    if (isTerminalJob(hubJobId)) return;

    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let reconnecting = false;

    const handleJobEvent =
      (eventName: JobEventName) => (event: MessageEvent<string>) => {
        useAhandJobTelemetryStore
          .getState()
          .applyEvent(
            hubJobId,
            eventName,
            parseEventData(event.data),
            event.lastEventId || undefined,
          );
      };

    const openStream = async (token?: string) => {
      const accessToken = token ?? (await getValidAccessToken());
      if (!accessToken) {
        if (!disposed) redirectToLogin();
        return;
      }

      if (disposed) return;
      if (isTerminalJob(hubJobId)) return;

      const params = new URLSearchParams({
        deviceId,
        token: accessToken,
      });
      const lastEventId =
        useAhandJobTelemetryStore.getState().jobs[hubJobId]?.lastEventId;
      if (lastEventId) {
        params.set("lastEventId", lastEventId);
      }
      const url = `${API_BASE_URL}/v1/ahand/jobs/${encodeURIComponent(
        hubJobId,
      )}/stream?${params.toString()}`;

      eventSource = new EventSource(url);
      for (const eventName of JOB_EVENTS) {
        eventSource.addEventListener(eventName, handleJobEvent(eventName));
      }
      eventSource.onerror = () => {
        if (disposed || reconnecting) return;

        eventSource?.close();
        eventSource = null;
        if (isTerminalJob(hubJobId)) return;

        reconnecting = true;

        void (async () => {
          const nextToken = await getValidAccessToken();
          if (!nextToken) {
            if (!disposed) redirectToLogin();
            return;
          }

          if (disposed) return;
          if (isTerminalJob(hubJobId)) return;

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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      eventSource?.close();
    };
  }, [deviceId, enabled, hubJobId]);
}

function isTerminalJob(hubJobId: string): boolean {
  const status = useAhandJobTelemetryStore.getState().jobs[hubJobId]?.status;
  return status === "finished" || status === "error";
}

function parseEventData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
