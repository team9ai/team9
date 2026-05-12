import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { DynamicSubSidebar } from "@/components/layout/DynamicSubSidebar";
import { SidebarNavRail } from "@/components/layout/SidebarNavRail";
import { RoutePendingOverlay } from "@/components/layout/RoutePendingOverlay";
import { useFontScales, useSidebarCollapsed } from "@/stores";
import type { CSSProperties } from "react";
import { GlobalTopBar } from "@/components/layout/GlobalTopBar";
import { UpdateDialog } from "@/components/layout/UpdateDialog";
import { ChannelSettingsMount } from "@/components/channel/ChannelSettingsMount";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useWebSocketEvents } from "@/hooks/useWebSocketEvents";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useServiceWorkerMessages } from "@/hooks/useServiceWorkerMessages";
import { useSyncUserLocale } from "@/hooks/useSyncUserLocale";
import { useAhandBootstrap } from "@/hooks/useAhandBootstrap";
import { useAhandJwtRefresh } from "@/hooks/useAhandJwtRefresh";
import { useWorkspaceBootstrap } from "@/hooks/useWorkspaceBootstrap";
import { registerServiceWorker } from "@/lib/push-notifications";
import { useEffect } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import {
  appActions,
  getSectionFromPath,
  isRestorableSectionPath,
} from "@/stores";
import { markStartup } from "@/lib/startup-profiler";
import { getAuthenticatedStartupRedirect } from "@/lib/authenticated-startup-redirect";
import { Button } from "@/components/ui/button";

const ONBOARDING_ROUTE = "/onboarding";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ location }) => {
    markStartup("auth.beforeLoad:start", {
      href: location.href,
      pathname: location.pathname,
    });

    const token = localStorage.getItem("auth_token");
    markStartup("auth.beforeLoad:token checked", {
      hasToken: Boolean(token),
    });

    const startupRedirect = getAuthenticatedStartupRedirect({ location });
    if (startupRedirect) {
      markStartup("auth.beforeLoad:redirect", startupRedirect);
      throw redirect({
        to: startupRedirect.to as never,
        search: startupRedirect.search as never,
      });
    }

    markStartup("auth.beforeLoad:end", {
      pathname: location.pathname,
    });
  },
  component: AuthenticatedLayout,
});

let authenticatedLayoutFirstRenderLogged = false;

function AuthenticatedLayout() {
  const location = useLocation();
  if (!authenticatedLayoutFirstRenderLogged) {
    authenticatedLayoutFirstRenderLogged = true;
    markStartup("auth.layout:render first", {
      pathname: location.pathname,
    });
  }

  const isOnboardingRoute = location.pathname === ONBOARDING_ROUTE;
  const sidebarCollapsed = useSidebarCollapsed();
  const fontScales = useFontScales();
  const sidebarFontStyle = {
    "--font-scale": fontScales.sidebar,
  } as CSSProperties;
  const mainFontStyle = {
    "--font-scale": fontScales.main,
  } as CSSProperties;

  // Resume aHand daemon connection if previously enabled
  useAhandBootstrap();

  // Hydrate workspace/onboarding state after the shell is visible.
  const workspaceBootstrap = useWorkspaceBootstrap();

  // Auto-refresh aHand JWT when daemon reports auth error
  useAhandJwtRefresh();

  // Initialize WebSocket connection
  useWebSocket();

  // Set up centralized WebSocket event listeners for React Query cache updates
  useWebSocketEvents();

  // Send periodic heartbeat to Service Worker for focus suppression
  useHeartbeat();

  // Push the browser's detected locale + time zone up to the gateway once
  // per authenticated session when they differ from what's already stored.
  // Bootstrap events emitted by personal-staff / common-staff gateway
  // services read these columns to populate `team9Context` so agents can
  // greet mentors in the right language. Fire-and-forget — failures are
  // non-fatal.
  useSyncUserLocale();

  // Register Service Worker for push notifications on mount
  useEffect(() => {
    markStartup("auth.layout:mounted", {
      pathname: window.location.pathname,
    });
    registerServiceWorker();
  }, []);

  // Handle messages from Service Worker (e.g. notification clicks)
  useServiceWorkerMessages();

  // Save current path as last visited for its corresponding section
  useEffect(() => {
    const pathname = location.pathname;
    if (pathname === "/" || pathname === ONBOARDING_ROUTE) return;

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

  const workspaceBootstrapPrompt =
    workspaceBootstrap.status === "failed" ||
    workspaceBootstrap.status === "retrying" ? (
      <WorkspaceBootstrapNetworkPrompt
        isRetrying={workspaceBootstrap.status === "retrying"}
        onRetry={workspaceBootstrap.retry}
      />
    ) : null;

  if (isOnboardingRoute) {
    return (
      <>
        <Outlet />
        {workspaceBootstrapPrompt}
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Global top bar with search */}
      <GlobalTopBar />
      <UpdateDialog />
      <ChannelSettingsMount />

      {/* Main content area with sidebars.
          Outer wrapper sets the sidebar font scope; <main> then re-applies
          font-scope with its own scale, overriding for the main region. */}
      <div
        className="font-scope flex flex-1 overflow-hidden bg-nav-bg"
        style={sidebarFontStyle}
      >
        <MainSidebar />

        {/* Content card — single source of truth for the rounded top-left.
            Everything to the right of the workspace rail lives inside this
            unified surface. */}
        <div className="flex flex-1 overflow-hidden rounded-tl-lg">
          {!sidebarCollapsed && <SidebarNavRail />}
          <DynamicSubSidebar />
          <main
            className="font-scope relative flex-1 overflow-hidden bg-background"
            style={mainFontStyle}
          >
            <Outlet />
            <RoutePendingOverlay />
            {workspaceBootstrapPrompt}
          </main>
        </div>
      </div>
    </div>
  );
}

function WorkspaceBootstrapNetworkPrompt({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 px-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 text-center shadow-lg">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <WifiOff className="size-5" />
        </div>
        <h2 className="text-base font-semibold text-foreground">
          需要联网才能加载工作区
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          请检查网络连接后重试。当前工作区信息没有加载完成，暂时无法继续进入应用。
        </p>
        <Button
          type="button"
          className="mt-5 w-full"
          onClick={onRetry}
          disabled={isRetrying}
        >
          <RefreshCw
            className={`mr-2 size-4 ${isRetrying ? "animate-spin" : ""}`}
          />
          {isRetrying ? "正在重试" : "重试"}
        </Button>
      </div>
    </div>
  );
}
