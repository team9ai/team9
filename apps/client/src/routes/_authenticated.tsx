import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { DynamicSubSidebar } from "@/components/layout/DynamicSubSidebar";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useWebSocketEvents } from "@/hooks/useWebSocketEvents";
import { useEffect } from "react";
import { appActions, useActiveSidebar, DEFAULT_SECTION_PATHS } from "@/stores";

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
            const activeSidebar = parsed?.state?.activeSidebar || "home";
            const lastVisitedPaths = parsed?.state?.lastVisitedPaths;
            const lastVisitedPath =
              lastVisitedPaths?.[activeSidebar] ??
              DEFAULT_SECTION_PATHS[
                activeSidebar as keyof typeof DEFAULT_SECTION_PATHS
              ];

            if (lastVisitedPath && lastVisitedPath !== "/") {
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
  const activeSidebar = useActiveSidebar();

  // Initialize WebSocket connection
  useWebSocket();

  // Set up centralized WebSocket event listeners for React Query cache updates
  useWebSocketEvents();

  // Save current path as last visited for the active section
  useEffect(() => {
    const pathname = location.pathname;
    if (pathname === "/") return;

    // Always save to the currently active sidebar section
    // This way, when user leaves a tab, we remember where they were
    appActions.setLastVisitedPath(activeSidebar, pathname);
  }, [location.pathname, activeSidebar]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Main navigation sidebar - leftmost */}
      <MainSidebar />

      {/* SubSidebar - dynamic based on route */}
      <DynamicSubSidebar />

      {/* Main content area */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
