import { create } from "zustand";

const MAX_SELECTED = 100;
export const FORWARD_SELECTION_MAX = MAX_SELECTED;

interface ForwardSelectionState {
  active: boolean;
  channelId: string | null;
  selectedIds: Set<string>;
  enter: (channelId: string) => void;
  exit: () => void;
  toggle: (messageId: string) => boolean;
  addRange: (messageIds: string[]) => number;
  clear: () => void;
  isSelected: (messageId: string) => boolean;
}

export const useForwardSelectionStore = create<ForwardSelectionState>(
  (set, get) => ({
    active: false,
    channelId: null,
    selectedIds: new Set(),
    enter: (channelId) =>
      set({ active: true, channelId, selectedIds: new Set() }),
    exit: () => set({ active: false, channelId: null, selectedIds: new Set() }),
    toggle: (messageId) => {
      const state = get();
      if (!state.active) return false;
      const next = new Set(state.selectedIds);
      if (next.has(messageId)) {
        next.delete(messageId);
        set({ selectedIds: next });
        return true;
      }
      if (next.size >= MAX_SELECTED) return false;
      next.add(messageId);
      set({ selectedIds: next });
      return true;
    },
    addRange: (messageIds) => {
      const state = get();
      if (!state.active) return 0;
      const next = new Set(state.selectedIds);
      let added = 0;
      for (const id of messageIds) {
        if (next.size >= MAX_SELECTED) break;
        if (!next.has(id)) {
          next.add(id);
          added += 1;
        }
      }
      if (added > 0) set({ selectedIds: next });
      return added;
    },
    clear: () => set({ selectedIds: new Set() }),
    isSelected: (messageId) => get().selectedIds.has(messageId),
  }),
);
