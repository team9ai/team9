import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useWebSocket } from "@/hooks/useWebSocket";

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

  // Initialize WebSocket connection
  useWebSocket();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Main navigation sidebar - leftmost */}
      {isDesktop && <MainSidebar />}

      {/* Child route content (includes SubSidebar and MainContent) */}
      <Outlet />

      {/* Mobile bottom navigation bar */}
      {!isDesktop && <MobileTabBar />}
    </div>
  );
}
