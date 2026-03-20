import { useConnectionStore } from "@/stores/connection";
import { useEventStore } from "@/stores/events";

export function ChannelList() {
  const channels = useConnectionStore((s) => s.channels);
  const { filters, setFilter } = useEventStore();
  const selectedChannelId = filters.channelId;

  if (channels.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-slate-600">
        No channels — connect first
      </div>
    );
  }

  return (
    <>
      <div className="px-3 py-2 bg-slate-900 border-b border-slate-700 text-[10px] uppercase tracking-widest text-slate-500">
        Channels ({channels.length})
      </div>
      {channels.map((ch) => (
        <div
          key={ch.id}
          className={`px-3 py-2 cursor-pointer border-b border-slate-800/50 ${selectedChannelId === ch.id ? "bg-sky-950/50 border-l-2 border-l-sky-400" : "hover:bg-slate-900/50 border-l-2 border-l-transparent"}`}
          onClick={() =>
            setFilter({ channelId: selectedChannelId === ch.id ? null : ch.id })
          }
        >
          <div className="text-xs text-slate-200">
            {ch.type === "direct" ? "DM" : "#"} {ch.name}
          </div>
          {ch.memberCount !== undefined && (
            <div className="text-[10px] text-slate-600">
              {ch.memberCount} members
            </div>
          )}
        </div>
      ))}
    </>
  );
}
