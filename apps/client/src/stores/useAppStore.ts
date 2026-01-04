import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

// Types
interface User {
  id: string;
  name: string;
  email: string;
}

interface AppState {
  // State
  user: User | null;
  theme: "light" | "dark";
  isLoading: boolean;
  lastVisitedPath: string | null;

  // Actions
  setUser: (user: User | null) => void;
  setTheme: (theme: "light" | "dark") => void;
  toggleTheme: () => void;
  setLoading: (loading: boolean) => void;
  setLastVisitedPath: (path: string | null) => void;
  reset: () => void;
}

// Initial state
const initialState = {
  user: null,
  theme: "light" as const,
  isLoading: false,
  lastVisitedPath: null as string | null,
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

        reset: () => set(initialState, false, "reset"),
      }),
      {
        name: "app-storage",
        partialize: (state) => ({
          theme: state.theme,
          lastVisitedPath: state.lastVisitedPath,
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

// Actions (can be used outside React components)
export const appActions = {
  setUser: (user: User | null) => useAppStore.getState().setUser(user),
  setTheme: (theme: "light" | "dark") => useAppStore.getState().setTheme(theme),
  toggleTheme: () => useAppStore.getState().toggleTheme(),
  setLoading: (loading: boolean) => useAppStore.getState().setLoading(loading),
  setLastVisitedPath: (path: string | null) =>
    useAppStore.getState().setLastVisitedPath(path),
  reset: () => useAppStore.getState().reset(),
};
