import type { DebugEvent } from "@/lib/types";

export function PresenceRenderer({ event }: { event: DebugEvent }) {
  const p = event.payload as Record<string, unknown> | undefined;
  const username = (p?.username ?? p?.userId ?? "unknown") as string;

  if (event.eventName === "user_online") {
    return (
      <span className="text-xs text-emerald-400">{username} came online</span>
    );
  }
  if (event.eventName === "user_offline") {
    return (
      <span className="text-xs text-slate-400">{username} went offline</span>
    );
  }
  if (event.eventName === "user_typing" || event.eventName === "typing_start") {
    return (
      <span className="text-xs text-purple-400">{username} is typing...</span>
    );
  }
  if (event.eventName === "typing_stop") {
    return (
      <span className="text-xs text-slate-500">{username} stopped typing</span>
    );
  }
  if (event.eventName === "user_status_changed") {
    const status = (p?.status ?? "unknown") as string;
    return (
      <span className="text-xs text-amber-400">
        {username} status: {status}
      </span>
    );
  }
  return null;
}
