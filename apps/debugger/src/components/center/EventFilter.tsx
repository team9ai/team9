import { useEventStore } from "@/stores/events";
import { CATEGORY_COLORS, type EventCategory } from "@/lib/events";

const DIRECTION_OPTIONS = [
  { value: "all", label: "All" },
  { value: "in", label: "↓ Received" },
  { value: "out", label: "↑ Sent" },
] as const;

const CATEGORY_OPTIONS: { value: EventCategory; label: string }[] = [
  { value: "message", label: "Messages" },
  { value: "streaming", label: "Streaming" },
  { value: "typing", label: "Typing" },
  { value: "presence", label: "Presence" },
  { value: "channel", label: "Channel" },
  { value: "reaction", label: "Reaction" },
  { value: "auth", label: "Auth" },
  { value: "routine", label: "Routine" },
  { value: "system", label: "System" },
];

export function EventFilter() {
  const { filters, setFilter } = useEventStore();

  const toggleCategory = (cat: EventCategory) => {
    const current = filters.categories;
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    setFilter({ categories: next });
  };

  return (
    <div className="flex items-center px-3 py-2 bg-slate-900 border-b border-slate-700 gap-2 flex-wrap">
      <span className="text-[10px] text-slate-500 uppercase tracking-widest">
        Events
      </span>
      <span className="text-slate-700">|</span>

      {/* Direction filter */}
      {DIRECTION_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setFilter({ direction: opt.value })}
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            filters.direction === opt.value
              ? "bg-sky-900/50 text-sky-400"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {opt.label}
        </button>
      ))}

      <span className="text-slate-700">|</span>

      {/* Category filter chips */}
      {CATEGORY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => toggleCategory(opt.value)}
          className={`text-[10px] px-1.5 py-0.5 rounded border ${
            filters.categories.includes(opt.value)
              ? "border-current opacity-100"
              : "border-transparent opacity-50 hover:opacity-75"
          }`}
          style={{ color: CATEGORY_COLORS[opt.value] }}
        >
          {opt.label}
        </button>
      ))}

      <div className="flex-1" />

      {/* Search */}
      <input
        className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-slate-200 w-40 focus:border-sky-500 focus:outline-none"
        placeholder="Filter events..."
        value={filters.search}
        onChange={(e) => setFilter({ search: e.target.value })}
      />
    </div>
  );
}
