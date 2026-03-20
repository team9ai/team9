import { useConnectionStore } from "@/stores/connection";

export function BotInfo() {
  const { botUserId, botUsername, status } = useConnectionStore();
  if (status !== "connected" || !botUserId) return null;

  return (
    <>
      <div className="px-3 py-2 bg-slate-900 border-b border-slate-700 border-t border-t-slate-700 text-[10px] uppercase tracking-widest text-slate-500">
        Bot Info
      </div>
      <div className="px-3 py-2 text-xs font-mono space-y-1">
        <div>
          <span className="text-slate-500">ID: </span>
          <span className="text-amber-400">{botUserId.slice(0, 8)}...</span>
        </div>
        <div>
          <span className="text-slate-500">User: </span>
          <span className="text-slate-200">{botUsername}</span>
        </div>
      </div>
    </>
  );
}
