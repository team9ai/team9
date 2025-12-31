import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

interface WorkspaceState {
  // State
  selectedWorkspaceId: string | null;

  // Actions
  setSelectedWorkspaceId: (id: string | null) => void;
  reset: () => void;
}

const initialState = {
  selectedWorkspaceId: null,
};

export const useWorkspaceStore = create<WorkspaceState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        setSelectedWorkspaceId: (id) =>
          set({ selectedWorkspaceId: id }, false, "setSelectedWorkspaceId"),

        reset: () => set(initialState, false, "reset"),
      }),
      {
        name: "workspace-storage",
      },
    ),
    { name: "WorkspaceStore" },
  ),
);

// Selectors
export const useSelectedWorkspaceId = () =>
  useWorkspaceStore((state) => state.selectedWorkspaceId);

// Actions (can be used outside React components)
export const workspaceActions = {
  setSelectedWorkspaceId: (id: string | null) =>
    useWorkspaceStore.getState().setSelectedWorkspaceId(id),
  reset: () => useWorkspaceStore.getState().reset(),
};
