import { create } from "zustand";
import type { DebugEvent } from "@/lib/types";
import { getEventCategory, type EventCategory } from "@/lib/events";

interface EventFilters {
  direction: "all" | "in" | "out";
  categories: EventCategory[];
  channelId: string | null;
  search: string;
}

interface EventStore {
  events: DebugEvent[];
  filters: EventFilters;
  selectedEventId: string | null;

  addEvent: (event: DebugEvent) => void;
  clearEvents: () => void;
  setFilter: (filter: Partial<EventFilters>) => void;
  setSelectedEvent: (id: string | null) => void;
  getFilteredEvents: () => DebugEvent[];
  exportEvents: () => void;
}

export const useEventStore = create<EventStore>((set, get) => ({
  events: [],
  filters: {
    direction: "all",
    categories: [],
    channelId: null,
    search: "",
  },
  selectedEventId: null,

  addEvent: (event) =>
    set((state) => {
      const MAX_EVENTS = 10_000;
      const events =
        state.events.length >= MAX_EVENTS
          ? [...state.events.slice(-MAX_EVENTS + 1), event]
          : [...state.events, event];
      return { events };
    }),

  clearEvents: () => set({ events: [], selectedEventId: null }),

  setFilter: (filter) =>
    set((state) => ({ filters: { ...state.filters, ...filter } })),

  setSelectedEvent: (id) => set({ selectedEventId: id }),

  getFilteredEvents: () => {
    const { events, filters } = get();
    return events.filter((e) => {
      if (filters.direction !== "all" && e.direction !== filters.direction)
        return false;
      if (
        filters.categories.length > 0 &&
        !filters.categories.includes(getEventCategory(e.eventName))
      )
        return false;
      if (filters.channelId && e.channelId !== filters.channelId) return false;
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesName = e.eventName.toLowerCase().includes(searchLower);
        const matchesPayload = JSON.stringify(e.payload)
          .toLowerCase()
          .includes(searchLower);
        if (!matchesName && !matchesPayload) return false;
      }
      return true;
    });
  },

  exportEvents: () => {
    const { events } = get();
    const blob = new Blob([JSON.stringify(events, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debugger-events-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
}));
