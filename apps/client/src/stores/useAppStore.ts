import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

// Types
interface User {
  id: string;
  name: string;
  email: string;
}

export type SidebarSection =
  | "home"
  | "messages"
  | "activity"
  | "files"
  | "more";

interface AppState {
  // State
  user: User | null;
  theme: "light" | "dark";
  isLoading: boolean;
  lastVisitedPath: string | null;
  activeSidebar: SidebarSection;

  // Actions
  setUser: (user: User | null) => void;
  setTheme: (theme: "light" | "dark") => void;
  toggleTheme: () => void;
  setLoading: (loading: boolean) => void;
  setLastVisitedPath: (path: string | null) => void;
  setActiveSidebar: (sidebar: SidebarSection) => void;
  reset: () => void;
}

// Initial state
const initialState = {
  user: null,
  theme: "light" as const,
  isLoading: false,
  lastVisitedPath: null as string | null,
  activeSidebar: "home" as SidebarSection,
};

// Store
export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        setUser: (user) => set({ user }, false, "setUser"),

        setTheme: (theme) => set({ theme }, false, "setTheme"),

        toggleTheme: () =>
          set(
            (state) => ({ theme: state.theme === "light" ? "dark" : "light" }),
            false,
            "toggleTheme",
          ),

        setLoading: (isLoading) => set({ isLoading }, false, "setLoading"),

        setLastVisitedPath: (lastVisitedPath) =>
          set({ lastVisitedPath }, false, "setLastVisitedPath"),

        setActiveSidebar: (activeSidebar) =>
          set({ activeSidebar }, false, "setActiveSidebar"),

        reset: () => set(initialState, false, "reset"),
      }),
      {
        name: "app-storage",
        partialize: (state) => ({
          theme: state.theme,
          lastVisitedPath: state.lastVisitedPath,
          activeSidebar: state.activeSidebar,
        }),
      },
    ),
    { name: "AppStore" },
  ),
);

// Selectors (for performance optimization)
export const useUser = () => useAppStore((state) => state.user);
export const useTheme = () => useAppStore((state) => state.theme);
export const useIsLoading = () => useAppStore((state) => state.isLoading);
export const useLastVisitedPath = () =>
  useAppStore((state) => state.lastVisitedPath);
export const useActiveSidebar = () =>
  useAppStore((state) => state.activeSidebar);

// Actions (can be used outside React components)
export const appActions = {
  setUser: (user: User | null) => useAppStore.getState().setUser(user),
  setTheme: (theme: "light" | "dark") => useAppStore.getState().setTheme(theme),
  toggleTheme: () => useAppStore.getState().toggleTheme(),
  setLoading: (loading: boolean) => useAppStore.getState().setLoading(loading),
  setLastVisitedPath: (path: string | null) =>
    useAppStore.getState().setLastVisitedPath(path),
  setActiveSidebar: (sidebar: SidebarSection) =>
    useAppStore.getState().setActiveSidebar(sidebar),
  reset: () => useAppStore.getState().reset(),
};
