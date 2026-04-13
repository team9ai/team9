import { useEffect, useRef } from "react";
import { createParser, EventSourceMessage } from "eventsource-parser";
import { useDeepResearchStore } from "@/stores/useDeepResearchStore";

export interface UseStreamOptions {
  taskId: string;
  // Returns the current auth triple. Invoked before each (re)connect so a
  // refreshed token is picked up automatically.
  getAuth: () => Promise<{ token: string; tenantId: string }>;
  // Disable auto-reconnect (used by unit tests needing deterministic flow).
  autoReconnect?: boolean;
}

// Exponential back-off schedule for reconnect attempts.
const BACKOFF = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export function useDeepResearchStream(opts: UseStreamOptions): void {
  const { taskId, getAuth, autoReconnect = true } = opts;
  const ingest = useDeepResearchStore((s) => s.ingest);
  const getLastSeq = useDeepResearchStore((s) => s.getLastSeq);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  // Hold getAuth in a ref so token-source churn from parent re-renders
  // does not tear down and restart the SSE connection on every render.
  const getAuthRef = useRef(getAuth);
  getAuthRef.current = getAuth;

  useEffect(() => {
    cancelledRef.current = false;
    let attempt = 0;

    const run = async (): Promise<void> => {
      while (!cancelledRef.current) {
        const ac = new AbortController();
        abortRef.current = ac;
        let completed = false;
        try {
          const { token, tenantId } = await getAuthRef.current();
          // Skip connecting until workspace store has hydrated a tenant id.
          // Otherwise an empty x-tenant-id makes the gateway fall through to
          // its host-based fallback, resolving the wrong tenant → 404.
          if (!token || !tenantId) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          const headers: Record<string, string> = {
            accept: "text/event-stream",
            authorization: `Bearer ${token}`,
            "x-tenant-id": tenantId,
          };
          const lastSeq = getLastSeq(taskId);
          if (lastSeq) headers["last-event-id"] = lastSeq;

          // Raw fetch bypasses the http client, so we can't rely on its
          // baseURL — build the absolute gateway URL from VITE_API_BASE_URL.
          const base = import.meta.env.VITE_API_BASE_URL ?? "";
          const res = await fetch(
            `${base}/v1/deep-research/tasks/${encodeURIComponent(taskId)}/stream`,
            { headers, signal: ac.signal },
          );
          if (res.status === 401) {
            // Let the HttpClient 401 interceptor refresh the token, then retry
            // once after a short delay.
            if (!autoReconnect) return;
            attempt = 0;
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          // Terminal client-side errors — task missing or access denied.
          // Retrying can't recover, so stop to avoid request storms.
          if (res.status === 404 || res.status === 403) return;
          if (!res.ok || !res.body) throw new Error(`upstream ${res.status}`);

          const parser = createParser({
            onEvent: (msg: EventSourceMessage) => {
              if (!msg.id && !msg.event) return; // heartbeat / comment line
              ingest(taskId, {
                seq: msg.id ?? "0",
                event: msg.event,
                data: msg.data,
              });
              if (
                msg.event === "interaction.complete" ||
                msg.event === "error"
              ) {
                completed = true;
              }
            },
          });
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            parser.feed(dec.decode(value, { stream: true }));
          }
          attempt = 0;
        } catch {
          // Swallow — a retry is scheduled below if autoReconnect is on.
        } finally {
          abortRef.current = null;
        }

        if (completed || cancelledRef.current || !autoReconnect) return;
        const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
        attempt += 1;
        await new Promise((r) => setTimeout(r, delay));
      }
    };

    void run();
    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
    };
    // getAuth is intentionally excluded — it's read via getAuthRef to avoid
    // tearing down the stream when parent re-renders produce a new reference.
  }, [taskId, autoReconnect, ingest, getLastSeq]);
}
