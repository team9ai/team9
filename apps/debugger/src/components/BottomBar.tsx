import { useConnectionStore } from "@/stores/connection";
import { useEventStore } from "@/stores/events";

export function BottomBar() {
  const { latencyMs } = useConnectionStore();
  const events = useEventStore((s) => s.events);

  const total = events.length;
  const received = events.filter((e) => e.direction === "in").length;
  const sent = events.filter((e) => e.direction === "out").length;

  return (
    <div className="flex items-center justify-between px-4 py-1 bg-slate-900 border-t border-slate-700 text-xs text-slate-500 font-mono">
      <div className="flex gap-4">
        <span>
          Events: <span className="text-slate-200">{total}</span>
        </span>
        <span>
          Received: <span className="text-sky-400">{received}</span>
        </span>
        <span>
          Sent: <span className="text-amber-400">{sent}</span>
        </span>
        {latencyMs !== null && (
          <span>
            Latency:{" "}
            <span
              className={
                latencyMs < 100 ? "text-emerald-400" : "text-amber-400"
              }
            >
              {latencyMs}ms
            </span>
          </span>
        )}
      </div>
      <span>Socket.io | Transport: websocket</span>
    </div>
  );
}
