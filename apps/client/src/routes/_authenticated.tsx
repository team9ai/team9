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
import { registerServiceWorker } from "@/lib/push-notifications";
import { queryClient } from "@/lib/query-client";
import {
  getEarliestOwnedWorkspace,
  getSessionWorkspaceId,
  isOnboardingRequired,
} from "@/lib/onboarding-gate";
import workspaceApi from "@/services/api/workspace";
import { useEffect } from "react";
import { workspaceActions, useWorkspaceStore } from "@/stores";
import {
  appActions,
  DEFAULT_SECTION_PATHS,
  getSectionFromPath,
  isRestorableSectionPath,
  isSidebarSection,
  sanitizeLastVisitedPaths,
} from "@/stores";
import type { UserWorkspace, WorkspaceOnboarding } from "@/types/workspace";

const ONBOARDING_ROUTE = "/onboarding";
const WORKSPACE_BOOTSTRAP_RETRY_COUNT = 5;
const WORKSPACE_BOOTSTRAP_RETRY_DELAY_MS = 300;
const ONBOARDING_BOOTSTRAP_RETRY_COUNT = 5;
const ONBOARDING_BOOTSTRAP_RETRY_DELAY_MS = 300;

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchUserWorkspaces() {
  const workspaces = await workspaceApi.getUserWorkspaces();
  queryClient.setQueryData(["user-workspaces"], workspaces);
  return workspaces;
}

async function fetchOnboardingState(workspaceId: string) {
  const onboarding = await workspaceApi.getOnboardingState(workspaceId);
  queryClient.setQueryData(["workspace-onboarding", workspaceId], onboarding);
  return onboarding;
}

async function getUserWorkspaces(options?: { forceRefresh?: boolean }) {
  const cached = queryClient.getQueryData<UserWorkspace[]>(["user-workspaces"]);
  if (!options?.forceRefresh && cached !== undefined) {
    return cached;
  }

  return fetchUserWorkspaces();
}

async function getUserWorkspacesWithBootstrapRetry() {
  let workspaces = await getUserWorkspaces();

  for (
    let attempt = 1;
    workspaces.length === 0 && attempt < WORKSPACE_BOOTSTRAP_RETRY_COUNT;
    attempt += 1
  ) {
    await wait(WORKSPACE_BOOTSTRAP_RETRY_DELAY_MS);
    workspaces = await getUserWorkspaces({ forceRefresh: true });
  }

  return workspaces;
}

async function getOnboardingState(
  workspaceId: string,
  options?: { forceRefresh?: boolean },
) {
  const cached = queryClient.getQueryData<WorkspaceOnboarding | null>([
    "workspace-onboarding",
    workspaceId,
  ]);
  if (!options?.forceRefresh && cached !== undefined) {
    return cached;
  }

  return fetchOnboardingState(workspaceId);
}

async function getOnboardingStateWithBootstrapRetry(workspaceId: string) {
  let onboarding = await getOnboardingState(workspaceId);

  for (
    let attempt = 1;
    onboarding === null && attempt < ONBOARDING_BOOTSTRAP_RETRY_COUNT;
    attempt += 1
  ) {
    await wait(ONBOARDING_BOOTSTRAP_RETRY_DELAY_MS);
    onboarding = await getOnboardingState(workspaceId, { forceRefresh: true });
  }

  return onboarding;
}

function getActiveWorkspaceId(workspaces: UserWorkspace[]) {
  const selectedWorkspaceId = useWorkspaceStore.getState().selectedWorkspaceId;
  const currentWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);

  return currentWorkspace?.id ?? workspaces[0]?.id ?? null;
}

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      });
    }

    const pathname = location.pathname;
    const workspaces = await getUserWorkspacesWithBootstrapRetry();
    const activeWorkspaceId = getActiveWorkspaceId(workspaces);
    const onboardingWorkspace = getEarliestOwnedWorkspace(workspaces);
    const onboarding = onboardingWorkspace
      ? await getOnboardingStateWithBootstrapRetry(onboardingWorkspace.id)
      : null;
    const onboardingRequired = isOnboardingRequired(onboarding);
    const sessionWorkspaceId = getSessionWorkspaceId({
      activeWorkspaceId,
      onboardingWorkspaceId: onboardingWorkspace?.id ?? null,
      onboardingRequired,
    });

    if (sessionWorkspaceId) {
      workspaceActions.setSelectedWorkspaceId(sessionWorkspaceId);

      if (
        onboardingRequired &&
        onboardingWorkspace &&
        pathname !== ONBOARDING_ROUTE
      ) {
        throw redirect({
          to: ONBOARDING_ROUTE,
          search: {
            workspaceId: onboardingWorkspace.id,
            step: onboarding.currentStep,
          },
        });
      }

      if (pathname === ONBOARDING_ROUTE && !onboardingRequired) {
        throw redirect({ to: "/" });
      }
    } else if (pathname === ONBOARDING_ROUTE) {
      throw redirect({ to: "/" });
    }

    // Redirect to last visited path only on initial app load (not on explicit navigation)
    if (pathname === "/") {
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

            const normalizedSidebar =
              activeSidebar as keyof typeof DEFAULT_SECTION_PATHS;
            const lastVisitedPath =
              lastVisitedPaths[normalizedSidebar] ??
              DEFAULT_SECTION_PATHS[normalizedSidebar];

            if (isRestorableSectionPath(lastVisitedPath)) {
              throw redirect({
                to: lastVisitedPath as never,
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

  if (isOnboardingRoute) {
    return <Outlet />;
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
          </main>
        </div>
      </div>
    </div>
  );
}
