import { create } from "zustand";

const MAX_SELECTED = 100;
export const FORWARD_SELECTION_MAX = MAX_SELECTED;

interface ForwardSelectionState {
  active: boolean;
  channelId: string | null;
  selectedIds: Set<string>;
  /**
   * Last single-click anchor used by Shift+click range selection.
   *
   * MUST live in the store rather than in a per-MessageItem ref —
   * otherwise the second click's MessageItem instance has no anchor
   * (Copilot review #101 finding). `toggle` updates this; `addRange`
   * preserves it; `enter`/`exit`/`clear` reset it.
   */
  anchorId: string | null;
  enter: (channelId: string) => void;
  exit: () => void;
  toggle: (messageId: string) => boolean;
  addRange: (messageIds: string[]) => number;
  clear: () => void;
  isSelected: (messageId: string) => boolean;
  setAnchor: (messageId: string | null) => void;
}

export const useForwardSelectionStore = create<ForwardSelectionState>(
  (set, get) => ({
    active: false,
    channelId: null,
    selectedIds: new Set(),
    anchorId: null,
    enter: (channelId) =>
      set({
        active: true,
        channelId,
        selectedIds: new Set(),
        anchorId: null,
      }),
    exit: () =>
      set({
        active: false,
        channelId: null,
        selectedIds: new Set(),
        anchorId: null,
      }),
    toggle: (messageId) => {
      const state = get();
      if (!state.active) return false;
      const next = new Set(state.selectedIds);
      if (next.has(messageId)) {
        next.delete(messageId);
        set({ selectedIds: next, anchorId: messageId });
        return true;
      }
      if (next.size >= MAX_SELECTED) return false;
      next.add(messageId);
      set({ selectedIds: next, anchorId: messageId });
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
    clear: () => set({ selectedIds: new Set(), anchorId: null }),
    isSelected: (messageId) => get().selectedIds.has(messageId),
    setAnchor: (messageId) => set({ anchorId: messageId }),
  }),
);
