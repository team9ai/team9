import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { DynamicSubSidebar } from "@/components/layout/DynamicSubSidebar";
import { GlobalTopBar } from "@/components/layout/GlobalTopBar";
import { ConnectionStatus } from "@/components/layout/ConnectionStatus";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useWebSocketEvents } from "@/hooks/useWebSocketEvents";
// import { useAHandSetupStore } from "@/stores/useAHandSetupStore";
// import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useEffect } from "react";
// import { invoke } from "@tauri-apps/api/core";
import {
  appActions,
  DEFAULT_SECTION_PATHS,
  getSectionFromPath,
  isRestorableSectionPath,
  isSidebarSection,
  sanitizeLastVisitedPaths,
} from "@/stores";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ location }) => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      });
    }

    // Redirect to last visited path only on initial app load (not on explicit navigation)
    if (location.pathname === "/") {
      const hasInitialized = sessionStorage.getItem("app_initialized");
      if (!hasInitialized) {
        sessionStorage.setItem("app_initialized", "true");
        const appStorage = localStorage.getItem("app-storage");
        if (appStorage) {
          try {
            const parsed = JSON.parse(appStorage);
            const activeSidebar = isSidebarSection(parsed?.state?.activeSidebar)
              ? parsed.state.activeSidebar
              : "home";
            const lastVisitedPaths = sanitizeLastVisitedPaths(
              parsed?.state?.lastVisitedPaths,
            );

            if (
              parsed?.state?.lastVisitedPaths &&
              JSON.stringify(parsed.state.lastVisitedPaths) !==
                JSON.stringify(lastVisitedPaths)
            ) {
              localStorage.setItem(
                "app-storage",
                JSON.stringify({
                  ...parsed,
                  state: {
                    ...parsed.state,
                    lastVisitedPaths,
                  },
                }),
              );
            }

            const lastVisitedPath =
              lastVisitedPaths?.[activeSidebar] ??
              DEFAULT_SECTION_PATHS[
                activeSidebar as keyof typeof DEFAULT_SECTION_PATHS
              ];

            if (isRestorableSectionPath(lastVisitedPath)) {
              throw redirect({
                to: lastVisitedPath,
              });
            }
          } catch (e) {
            // If it's a redirect, rethrow it
            if (
              e instanceof Response ||
              (e && typeof e === "object" && "to" in e)
            ) {
              throw e;
            }
            // Ignore JSON parse errors
          }
        }
      }
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const location = useLocation();

  // [DISABLED] aHand auto-start and Local Device Setup dialog
  // const ahandRun = useAHandSetupStore((s) => s.run);
  // const ahandOpenDialog = useAHandSetupStore((s) => s.openDialog);
  // const ahandHasRun = useAHandSetupStore((s) => s.hasRun);
  // const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  //
  // useEffect(() => {
  //   const isTauri =
  //     typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  //   if (ahandHasRun || !isTauri || !selectedWorkspaceId) return;
  //   ahandOpenDialog();
  //   void ahandRun();
  // }, [ahandRun, ahandOpenDialog, ahandHasRun, selectedWorkspaceId]);
  //
  // useEffect(() => {
  //   const isTauri =
  //     typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  //   if (!isTauri) return;
  //   return () => {
  //     invoke("ahand_stop").catch(() => {});
  //   };
  // }, []);

  // Initialize WebSocket connection
  useWebSocket();

  // Set up centralized WebSocket event listeners for React Query cache updates
  useWebSocketEvents();

  // Save current path as last visited for its corresponding section
  useEffect(() => {
    const pathname = location.pathname;
    if (pathname === "/") return;

    // Don't save global or utility pages as a last visited path for any section
    // Search and profile are not part of the main sidebar navigation model.
    if (!isRestorableSectionPath(pathname)) {
      return;
    }

    // Determine which section this path belongs to based on the path itself
    // This ensures paths are always saved to the correct section,
    // regardless of the current activeSidebar state (which may be stale)
    const pathSection = getSectionFromPath(pathname);
    appActions.setLastVisitedPath(pathSection, pathname);
  }, [location.pathname]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Global top bar with search */}
      <GlobalTopBar />
      <ConnectionStatus />

      {/* Main content area with sidebars */}
      <div className="flex flex-1 overflow-hidden">
        <MainSidebar />
        <DynamicSubSidebar />

        {/* Main content area */}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
