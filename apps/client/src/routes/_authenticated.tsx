import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { DynamicSubSidebar } from "@/components/layout/DynamicSubSidebar";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Sheet } from "@/components/ui/sheet";
import { useState } from "react";

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
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const isDesktop = useIsDesktop();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Initialize WebSocket connection
  useWebSocket();

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
