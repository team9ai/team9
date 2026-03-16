import { useConnectionStore } from "@/stores/connection";
import { useEventStore } from "@/stores/events";
import { disconnect } from "@/services/debug-socket";

const STATUS_STYLES: Record<string, string> = {
  connected: "bg-emerald-900/50 text-emerald-400",
  connecting: "bg-yellow-900/50 text-yellow-400",
  authenticating: "bg-yellow-900/50 text-yellow-400",
  disconnected: "bg-slate-700/50 text-slate-400",
  error: "bg-red-900/50 text-red-400",
};

const STATUS_DOT: Record<string, string> = {
  connected: "text-emerald-400",
  connecting: "text-yellow-400 animate-pulse",
  authenticating: "text-yellow-400 animate-pulse",
  disconnected: "text-slate-500",
  error: "text-red-400",
};

export function TopBar() {
  const { status, botUsername, serverUrl, errorMessage } = useConnectionStore();
  const { clearEvents, exportEvents } = useEventStore();

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700">
      <div className="flex items-center gap-3">
        <span className="font-bold text-sky-400 text-sm">Bot Debugger</span>
        <span
          className={`px-2 py-0.5 rounded text-xs font-mono ${STATUS_STYLES[status]}`}
        >
          <span className={STATUS_DOT[status]}>●</span> {status}
        </span>
        {botUsername && (
          <span className="text-xs text-slate-400 font-mono">
            bot: {botUsername} | {serverUrl}
          </span>
        )}
        {errorMessage && (
          <span className="text-xs text-red-400">{errorMessage}</span>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={clearEvents}
          className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-800"
        >
          Clear
        </button>
        <button
          onClick={exportEvents}
          className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-800"
        >
          Export
        </button>
        {status === "connected" && (
          <button
            onClick={disconnect}
            className="px-2 py-1 text-xs bg-red-700 rounded hover:bg-red-600"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
