import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

// Types
interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  createdAt?: string;
}

export type SidebarSection =
  | "home"
  | "messages"
  | "activity"
  | "files"
  | "aiStaff"
  | "routines"
  | "skills"
  | "resources"
  | "wiki"
  | "application"
  | "more";

export const ALL_SIDEBAR_SECTIONS: SidebarSection[] = [
  "home",
  "messages",
  "activity",
  "files",
  "aiStaff",
  "routines",
  "skills",
  "resources",
  "wiki",
  "application",
  "more",
];

// Default paths for each sidebar section
export const DEFAULT_SECTION_PATHS: Record<SidebarSection, string> = {
  home: "/channels",
  messages: "/messages",
  activity: "/activity",
  files: "/files",
  aiStaff: "/ai-staff",
  routines: "/routines",
  skills: "/skills",
  resources: "/resources",
  wiki: "/wiki",
  application: "/application",
  more: "/more",
};

type SectionPaths = Record<SidebarSection, string | null>;

const createEmptySectionPaths = (): SectionPaths =>
  Object.fromEntries(
    ALL_SIDEBAR_SECTIONS.map((section) => [section, null]),
  ) as SectionPaths;

export function isSidebarSection(value: unknown): value is SidebarSection {
  return (
    typeof value === "string" &&
    ALL_SIDEBAR_SECTIONS.includes(value as SidebarSection)
  );
}

export function isRestorableSectionPath(pathname: string | null | undefined) {
  return Boolean(
    pathname &&
    pathname !== "/" &&
    !pathname.startsWith("/search") &&
    !pathname.startsWith("/profile"),
  );
}

export function sanitizeLastVisitedPaths(
  paths: Partial<Record<SidebarSection, string | null>> | null | undefined,
): SectionPaths {
  return Object.fromEntries(
    ALL_SIDEBAR_SECTIONS.map((section) => {
      const path = paths?.[section];
      return [section, isRestorableSectionPath(path) ? path : null];
    }),
  ) as SectionPaths;
}

/**
 * Determines which section a path belongs to.
 */
export function getSectionFromPath(pathname: string): SidebarSection {
  if (pathname.startsWith("/channels")) return "home";
  if (pathname.startsWith("/messages")) return "messages";
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname.startsWith("/files")) return "files";
  if (pathname.startsWith("/ai-staff")) return "aiStaff";
  if (pathname.startsWith("/routines")) return "routines";
  if (pathname.startsWith("/skills")) return "skills";
  if (pathname.startsWith("/resources")) return "resources";
  if (pathname.startsWith("/wiki")) return "wiki";
  if (pathname.startsWith("/application")) return "application";
  if (pathname.startsWith("/more")) return "more";
  // Fallback to home for unknown paths
  return "home";
}

export type FontScaleRegion = "sidebar" | "main";

export interface FontScales {
  sidebar: number;
  main: number;
}

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.4;
export const FONT_SCALE_STEP = 0.05;
export const FONT_SCALE_DEFAULT = 1;

const DEFAULT_FONT_SCALES: FontScales = {
  sidebar: FONT_SCALE_DEFAULT,
  main: FONT_SCALE_DEFAULT,
};

function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
}

function sanitizeFontScales(input: unknown): FontScales {
  if (!input || typeof input !== "object") return { ...DEFAULT_FONT_SCALES };
  const obj = input as Partial<Record<FontScaleRegion, unknown>>;
  return {
    sidebar:
      typeof obj.sidebar === "number"
        ? clampFontScale(obj.sidebar)
        : FONT_SCALE_DEFAULT,
    main:
      typeof obj.main === "number"
        ? clampFontScale(obj.main)
        : FONT_SCALE_DEFAULT,
  };
}

interface AppState {
  // State
  user: User | null;
  theme: "light" | "dark";
  isLoading: boolean;
  lastVisitedPaths: SectionPaths;
  activeSidebar: SidebarSection;
  sidebarCollapsed: boolean;
  fontScales: FontScales;

  // Actions
  setUser: (user: User | null) => void;
  setTheme: (theme: "light" | "dark") => void;
  toggleTheme: () => void;
  setLoading: (loading: boolean) => void;
  setLastVisitedPath: (section: SidebarSection, path: string | null) => void;
  setActiveSidebar: (sidebar: SidebarSection) => void;
  resetNavigationForWorkspaceEntry: () => void;
  toggleSidebarCollapsed: () => void;
  setFontScale: (region: FontScaleRegion, value: number) => void;
  resetFontScales: () => void;
  reset: () => void;
}

// Initial state
const initialState = {
  user: null,
  theme: "light" as const,
  isLoading: false,
  lastVisitedPaths: createEmptySectionPaths(),
  activeSidebar: "home" as SidebarSection,
  sidebarCollapsed: false,
  fontScales: { ...DEFAULT_FONT_SCALES },
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

        setLastVisitedPath: (section, path) =>
          set(
            (state) => ({
              lastVisitedPaths: {
                ...state.lastVisitedPaths,
                [section]: path,
              },
            }),
            false,
            "setLastVisitedPath",
          ),

        setActiveSidebar: (activeSidebar) =>
          set({ activeSidebar }, false, "setActiveSidebar"),

        resetNavigationForWorkspaceEntry: () =>
          set(
            {
              activeSidebar: "home",
              lastVisitedPaths: createEmptySectionPaths(),
            },
            false,
            "resetNavigationForWorkspaceEntry",
          ),

        toggleSidebarCollapsed: () =>
          set(
            (state) => ({ sidebarCollapsed: !state.sidebarCollapsed }),
            false,
            "toggleSidebarCollapsed",
          ),

        setFontScale: (region, value) =>
          set(
            (state) => ({
              fontScales: {
                ...state.fontScales,
                [region]: clampFontScale(value),
              },
            }),
            false,
            "setFontScale",
          ),

        resetFontScales: () =>
          set(
            { fontScales: { ...DEFAULT_FONT_SCALES } },
            false,
            "resetFontScales",
          ),

        reset: () => set(initialState, false, "reset"),
      }),
      {
        name: "app-storage",
        partialize: (state) => ({
          theme: state.theme,
          lastVisitedPaths: state.lastVisitedPaths,
          activeSidebar: state.activeSidebar,
          sidebarCollapsed: state.sidebarCollapsed,
          fontScales: state.fontScales,
        }),
        merge: (persisted, current) => {
          const persistedState = (persisted ?? {}) as Partial<AppState>;
          return {
            ...current,
            ...persistedState,
            fontScales: sanitizeFontScales(persistedState.fontScales),
          };
        },
      },
    ),
    { name: "AppStore" },
  ),
);

// Selectors (for performance optimization)
export const useUser = () => useAppStore((state) => state.user);
export const useTheme = () => useAppStore((state) => state.theme);
export const useIsLoading = () => useAppStore((state) => state.isLoading);
export const useLastVisitedPaths = () =>
  useAppStore((state) => state.lastVisitedPaths);
export const useActiveSidebar = () =>
  useAppStore((state) => state.activeSidebar);
export const useSidebarCollapsed = () =>
  useAppStore((state) => state.sidebarCollapsed);
export const useFontScales = () => useAppStore((state) => state.fontScales);
export const useFontScale = (region: FontScaleRegion) =>
  useAppStore((state) => state.fontScales[region]);

// Get last visited path for a specific section
export const getLastVisitedPath = (section: SidebarSection): string => {
  const paths = useAppStore.getState().lastVisitedPaths;
  return paths[section] ?? DEFAULT_SECTION_PATHS[section];
};

// Actions (can be used outside React components)
export const appActions = {
  setUser: (user: User | null) => useAppStore.getState().setUser(user),
  setTheme: (theme: "light" | "dark") => useAppStore.getState().setTheme(theme),
  toggleTheme: () => useAppStore.getState().toggleTheme(),
  setLoading: (loading: boolean) => useAppStore.getState().setLoading(loading),
  setLastVisitedPath: (section: SidebarSection, path: string | null) =>
    useAppStore.getState().setLastVisitedPath(section, path),
  setActiveSidebar: (sidebar: SidebarSection) =>
    useAppStore.getState().setActiveSidebar(sidebar),
  resetNavigationForWorkspaceEntry: () =>
    useAppStore.getState().resetNavigationForWorkspaceEntry(),
  toggleSidebarCollapsed: () => useAppStore.getState().toggleSidebarCollapsed(),
  setFontScale: (region: FontScaleRegion, value: number) =>
    useAppStore.getState().setFontScale(region, value),
  resetFontScales: () => useAppStore.getState().resetFontScales(),
  reset: () => useAppStore.getState().reset(),
};
