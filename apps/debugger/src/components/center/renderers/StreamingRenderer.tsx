import type { DebugEvent } from "@/lib/types";
import { useEventStore } from "@/stores/events";

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

/** Aggregated streaming view — shows accumulated content for a streamId */
export function StreamingAggregateRenderer({ streamId }: { streamId: string }) {
  const events = useEventStore((s) => s.events);
  const streamEvents = events.filter(
    (e) => e.meta?.streamId === streamId && e.eventName === "streaming_content",
  );

  if (streamEvents.length === 0) return null;

  const lastContent = streamEvents[streamEvents.length - 1];
  const content = (lastContent.payload as Record<string, unknown>)
    ?.content as string;

  return (
    <div className="bg-slate-950 rounded p-2 mt-1 border border-amber-500/20">
      <div className="text-[10px] text-amber-400 mb-1">
        Streaming ({streamEvents.length} chunks)
      </div>
      <div className="text-xs text-slate-300 break-words whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}
