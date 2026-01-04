import { create } from "zustand";
import { devtools } from "zustand/middleware";

// Types
interface HomeState {
  // State
  selectedChannelId: string | null;

  // Actions
  setSelectedChannelId: (channelId: string | null) => void;
  reset: () => void;
}

// Initial state
const initialState = {
  selectedChannelId: null,
};

// Store
export const useHomeStore = create<HomeState>()(
  devtools(
    (set) => ({
      ...initialState,

      setSelectedChannelId: (selectedChannelId) =>
        set({ selectedChannelId }, false, "setSelectedChannelId"),

      reset: () => set(initialState, false, "reset"),
    }),
    { name: "HomeStore" },
  ),
);

// Selectors (for performance optimization)
export const useSelectedChannelId = () =>
  useHomeStore((state) => state.selectedChannelId);

// Actions (can be used outside React components)
export const homeActions = {
  setSelectedChannelId: (channelId: string | null) =>
    useHomeStore.getState().setSelectedChannelId(channelId),
  reset: () => useHomeStore.getState().reset(),
};
