import type { DebugEvent } from "@/lib/types";

export function StreamingRenderer({ event }: { event: DebugEvent }) {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p) return null;

  const streamId = p.streamId as string | undefined;
  const content = p.content as string | undefined;
  const reason = p.reason as string | undefined;

  if (event.eventName === "streaming_start") {
    return (
      <div className="text-xs text-slate-400 mt-1">
        Stream{" "}
        <span className="text-amber-400 font-mono">
          {streamId?.slice(0, 8)}...
        </span>{" "}
        started
      </div>
    );
  }

  if (
    event.eventName === "streaming_content" ||
    event.eventName === "streaming_thinking_content"
  ) {
    const isThinking = event.eventName === "streaming_thinking_content";
    return (
      <div
        className={`bg-slate-950 rounded p-2 mt-1 ${isThinking ? "border-l-2 border-purple-500" : ""}`}
      >
        <div className="text-xs text-slate-300 break-words whitespace-pre-wrap">
          {isThinking && (
            <span className="text-purple-400 text-[10px]">[thinking] </span>
          )}
          {content}
        </div>
      </div>
    );
  }

  if (event.eventName === "streaming_end") {
    return (
      <div className="text-xs text-emerald-400 mt-1">
        Stream <span className="font-mono">{streamId?.slice(0, 8)}...</span>{" "}
        ended
      </div>
    );
  }

  if (event.eventName === "streaming_abort") {
    return (
      <div className="text-xs text-red-400 mt-1">
        Stream <span className="font-mono">{streamId?.slice(0, 8)}...</span>{" "}
        aborted: {reason}
      </div>
    );
  }

  return null;
}
