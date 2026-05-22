import { create } from "zustand";
import { devtools } from "zustand/middleware";

export type HomeDashboardMode = "conversation" | "task";

// Types
interface HomeState {
  // State
  selectedChannelId: string | null;
  dashboardMode: HomeDashboardMode;

  // Actions
  setSelectedChannelId: (channelId: string | null) => void;
  setDashboardMode: (mode: HomeDashboardMode) => void;
  reset: () => void;
}

// Initial state
const initialState = {
  selectedChannelId: null,
  dashboardMode: "conversation" as HomeDashboardMode,
};

// Store
export const useHomeStore = create<HomeState>()(
  devtools(
    (set) => ({
      ...initialState,

      setSelectedChannelId: (selectedChannelId) =>
        set({ selectedChannelId }, false, "setSelectedChannelId"),

      setDashboardMode: (dashboardMode) =>
        set({ dashboardMode }, false, "setDashboardMode"),

      reset: () => set(initialState, false, "reset"),
    }),
    { name: "HomeStore" },
  ),
);

// Selectors (for performance optimization)
export const useSelectedChannelId = () =>
  useHomeStore((state) => state.selectedChannelId);
export const useDashboardMode = () =>
  useHomeStore((state) => state.dashboardMode);

// Actions (can be used outside React components)
export const homeActions = {
  setSelectedChannelId: (channelId: string | null) =>
    useHomeStore.getState().setSelectedChannelId(channelId),
  setDashboardMode: (mode: HomeDashboardMode) =>
    useHomeStore.getState().setDashboardMode(mode),
  reset: () => useHomeStore.getState().reset(),
};
