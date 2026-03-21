import { useState } from "react";
import type { DebugEvent } from "@/lib/types";
import { getEventCategory, CATEGORY_COLORS } from "@/lib/events";
import { formatTimestamp, formatBytes } from "@/lib/utils";
import { renderEventPreview } from "./renderers";
import { useEventStore } from "@/stores/events";

export function EventCard({ event }: { event: DebugEvent }) {
  const [showJson, setShowJson] = useState(false);
  const setSelectedEvent = useEventStore((s) => s.setSelectedEvent);
  const selectedEventId = useEventStore((s) => s.selectedEventId);

  const category = getEventCategory(event.eventName);
  const color = CATEGORY_COLORS[category];
  const isSelected = selectedEventId === event.id;
  const dirArrow = event.direction === "in" ? "↓" : "↑";

  return (
    <div
      className={`mx-2 mb-1.5 p-2 rounded-md border-l-[3px] cursor-pointer transition-colors ${
        isSelected
          ? "bg-slate-800 ring-1 ring-sky-500/50"
          : "bg-slate-900 hover:bg-slate-850"
      }`}
      style={{ borderLeftColor: color }}
      onClick={() => setSelectedEvent(isSelected ? null : event.id)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold font-mono" style={{ color }}>
          {dirArrow} {event.eventName}
        </span>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          {event.channelId && (
            <span className="font-mono">{event.channelId.slice(0, 8)}...</span>
          )}
          <span>{formatTimestamp(event.timestamp)}</span>
        </div>
      </div>

      {/* Semantic preview */}
      {renderEventPreview(event)}

      {/* Raw JSON toggle */}
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowJson(!showJson);
          }}
          className="text-[10px] text-slate-600 hover:text-slate-400"
        >
          {showJson ? "▼" : "▶"} Raw JSON ({formatBytes(event.meta?.size ?? 0)})
        </button>
      </div>

      {showJson && (
        <pre className="mt-1 p-2 bg-slate-950 rounded text-[10px] text-slate-400 font-mono overflow-x-auto max-h-48 overflow-y-auto">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
