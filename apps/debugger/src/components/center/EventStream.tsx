import { useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEventStore } from "@/stores/events";
import { EventFilter } from "./EventFilter";
import { EventCard } from "./EventCard";

export function EventStream() {
  const filteredEvents = useEventStore((s) => s.getFilteredEvents());
  const parentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: filteredEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 10,
  });

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScrollRef.current && filteredEvents.length > 0) {
      virtualizer.scrollToIndex(filteredEvents.length - 1, {
        align: "end",
      });
    }
  }, [filteredEvents.length, virtualizer]);

  // Detect user scroll to disable auto-scroll
  const handleScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    autoScrollRef.current = atBottom;
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <EventFilter />
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        {filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-slate-600">
            No events yet
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const event = filteredEvents[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <EventCard event={event} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
