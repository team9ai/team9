import { useEventStore } from "@/stores/events";
import { getEventCategory, CATEGORY_COLORS } from "@/lib/events";
import { formatTimestamp, formatBytes } from "@/lib/utils";

export function Inspector() {
  const selectedEventId = useEventStore((s) => s.selectedEventId);
  const events = useEventStore((s) => s.events);
  const event = events.find((e) => e.id === selectedEventId);

  if (!event) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-slate-600 p-4">
        Click an event in the stream to inspect it
      </div>
    );
  }

  const category = getEventCategory(event.eventName);
  const color = CATEGORY_COLORS[category];

  return (
    <div className="p-3 space-y-3 text-xs">
      <div>
        <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">
          Event
        </div>
        <div className="font-mono font-bold" style={{ color }}>
          {event.direction === "in" ? "\u2193" : "\u2191"} {event.eventName}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] text-slate-500">Time</div>
          <div className="font-mono">{formatTimestamp(event.timestamp)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">Direction</div>
          <div>{event.direction === "in" ? "Received" : "Sent"}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">Size</div>
          <div className="font-mono">{formatBytes(event.meta?.size ?? 0)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">Category</div>
          <div style={{ color }}>{category}</div>
        </div>
        {event.channelId && (
          <div className="col-span-2">
            <div className="text-[10px] text-slate-500">Channel</div>
            <div className="font-mono text-amber-400">{event.channelId}</div>
          </div>
        )}
        {event.meta?.streamId && (
          <div className="col-span-2">
            <div className="text-[10px] text-slate-500">Stream ID</div>
            <div className="font-mono text-amber-400">
              {event.meta.streamId}
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">
            Payload
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(
                JSON.stringify(event.payload, null, 2),
              );
            }}
            className="text-[10px] text-slate-500 hover:text-slate-300"
          >
            Copy
          </button>
        </div>
        <pre className="p-2 bg-slate-950 rounded text-[10px] text-slate-300 font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}
