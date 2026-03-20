import type { DebugEvent } from "@/lib/types";

export function GenericRenderer({ event }: { event: DebugEvent }) {
  const summary =
    typeof event.payload === "object" && event.payload !== null
      ? JSON.stringify(event.payload).slice(0, 120)
      : String(event.payload ?? "");

  return (
    <div className="text-xs text-slate-400 mt-1 font-mono truncate">
      {summary}
      {summary.length >= 120 && "..."}
    </div>
  );
}
