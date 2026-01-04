import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { DynamicSubSidebar } from "@/components/layout/DynamicSubSidebar";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Sheet } from "@/components/ui/sheet";
import { useState, useEffect } from "react";
import {
  appActions,
  useActiveSidebar,
  DEFAULT_SECTION_PATHS,
  type SidebarSection,
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

// Helper to determine which section a path belongs to
function getSectionFromPath(pathname: string): SidebarSection {
  if (pathname.startsWith("/messages") || pathname.startsWith("/channels")) {
    // Check if we're in a channel view - use the active sidebar
    if (pathname.startsWith("/channels")) {
      // Will be handled by activeSidebar in the effect
      return "home"; // Default, will be overridden
    }
    return "messages";
  }
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname.startsWith("/files")) return "files";
  if (pathname.startsWith("/more")) return "more";
  return "home";
}

function AuthenticatedLayout() {
  const isDesktop = useIsDesktop();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const location = useLocation();
  const activeSidebar = useActiveSidebar();

  // Initialize WebSocket connection
  useWebSocket();

  // Save current path as last visited for the active section
  useEffect(() => {
    const pathname = location.pathname;
    if (pathname === "/") return;

    // For channel routes, save to the active sidebar section
    // For other routes, determine section from path
    const section = pathname.startsWith("/channels")
      ? activeSidebar
      : getSectionFromPath(pathname);

    appActions.setLastVisitedPath(section, pathname);
  }, [location.pathname, activeSidebar]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Main navigation sidebar - leftmost */}
      {isDesktop && <MainSidebar />}

      {/* SubSidebar - dynamic based on route */}
      {isDesktop ? (
        <DynamicSubSidebar />
      ) : (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen} side="left">
          <DynamicSubSidebar />
        </Sheet>
      )}

      {/* Main content area */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {/* Mobile bottom navigation bar */}
      {!isDesktop && <MobileTabBar />}
    </div>
  );
}
