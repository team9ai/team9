import type { DebugEvent } from "@/lib/types";

export function MessageRenderer({ event }: { event: DebugEvent }) {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p) return null;

  const sender =
    (p.sender as Record<string, unknown>)?.displayName ??
    (p.sender as Record<string, unknown>)?.username ??
    p.senderId ??
    "unknown";
  const content = (p.content as string) ?? "";
  const parentId = p.parentId as string | undefined;

  return (
    <div className="bg-slate-950 rounded p-2 mt-1">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center text-[9px] text-white font-bold">
          {String(sender).charAt(0).toUpperCase()}
        </div>
        <span className="text-xs font-medium text-slate-200">
          {String(sender)}
        </span>
        {parentId && (
          <span className="text-[10px] text-slate-500">
            (thread: {String(parentId).slice(0, 8)}...)
          </span>
        )}
      </div>
      <div className="text-xs text-slate-300 pl-6 break-words">{content}</div>
    </div>
  );
}
