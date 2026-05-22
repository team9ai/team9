import { create } from "zustand";
import { devtools } from "zustand/middleware";

export type HomeDashboardMode = "conversation" | "task";

export interface DashboardModeTransition {
  id: number;
  from: HomeDashboardMode;
  to: HomeDashboardMode;
}

interface SetDashboardModeOptions {
  animate?: boolean;
}

let nextDashboardModeTransitionId = 0;

// Types
interface HomeState {
  // State
  selectedChannelId: string | null;
  dashboardMode: HomeDashboardMode;
  dashboardModeTransition: DashboardModeTransition | null;

  // Actions
  setSelectedChannelId: (channelId: string | null) => void;
  setDashboardMode: (
    mode: HomeDashboardMode,
    options?: SetDashboardModeOptions,
  ) => void;
  clearDashboardModeTransition: (transitionId?: number) => void;
  reset: () => void;
}

// Initial state
const initialState = {
  selectedChannelId: null,
  dashboardMode: "conversation" as HomeDashboardMode,
  dashboardModeTransition: null,
};

// Store
export const useHomeStore = create<HomeState>()(
  devtools(
    (set) => ({
      ...initialState,

      setSelectedChannelId: (selectedChannelId) =>
        set({ selectedChannelId }, false, "setSelectedChannelId"),

      setDashboardMode: (dashboardMode, options) =>
        set(
          (state) => {
            if (state.dashboardMode === dashboardMode) {
              return state;
            }

            return {
              dashboardMode,
              dashboardModeTransition: options?.animate
                ? {
                    id: ++nextDashboardModeTransitionId,
                    from: state.dashboardMode,
                    to: dashboardMode,
                  }
                : null,
            };
          },
          false,
          "setDashboardMode",
        ),

      clearDashboardModeTransition: (transitionId) =>
        set(
          (state) => {
            if (!state.dashboardModeTransition) {
              return state;
            }

            if (
              transitionId !== undefined &&
              state.dashboardModeTransition.id !== transitionId
            ) {
              return state;
            }

            return { dashboardModeTransition: null };
          },
          false,
          "clearDashboardModeTransition",
        ),

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
export const useDashboardModeTransition = () =>
  useHomeStore((state) => state.dashboardModeTransition);

// Actions (can be used outside React components)
export const homeActions = {
  setSelectedChannelId: (channelId: string | null) =>
    useHomeStore.getState().setSelectedChannelId(channelId),
  setDashboardMode: (
    mode: HomeDashboardMode,
    options?: SetDashboardModeOptions,
  ) => useHomeStore.getState().setDashboardMode(mode, options),
  clearDashboardModeTransition: (transitionId?: number) =>
    useHomeStore.getState().clearDashboardModeTransition(transitionId),
  reset: () => useHomeStore.getState().reset(),
};
