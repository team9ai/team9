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
import { appActions } from "@/stores";

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
          let lastVisitedPath: string | null = null;
          try {
            const parsed = JSON.parse(appStorage);
            lastVisitedPath = parsed?.state?.lastVisitedPath;
          } catch {
            // Ignore JSON parse errors
          }
          if (lastVisitedPath && lastVisitedPath !== "/") {
            throw redirect({
              to: lastVisitedPath,
            });
          }
        }
      }
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const isDesktop = useIsDesktop();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const location = useLocation();

  // Initialize WebSocket connection
  useWebSocket();

  // Save current path as last visited (skip root path)
  useEffect(() => {
    if (location.pathname !== "/") {
      appActions.setLastVisitedPath(location.pathname);
    }
  }, [location.pathname]);

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
