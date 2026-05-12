import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { queryClient } from "@/lib/query-client";
import {
  getEarliestOwnedWorkspace,
  getSessionWorkspaceId,
  isOnboardingRequired,
} from "@/lib/onboarding-gate";
import {
  readWorkspaceBootstrapCache,
  writeWorkspaceBootstrapCache,
  type WorkspaceBootstrapSnapshot,
} from "@/lib/workspace-bootstrap-cache";
import { markStartup, measureStartup } from "@/lib/startup-profiler";
import workspaceApi from "@/services/api/workspace";
import { workspaceActions, useWorkspaceStore } from "@/stores";
import type { UserWorkspace, WorkspaceOnboarding } from "@/types/workspace";

const ONBOARDING_ROUTE = "/onboarding";
const WORKSPACE_BOOTSTRAP_RETRY_COUNT = 5;
const WORKSPACE_BOOTSTRAP_RETRY_DELAY_MS = 300;
const ONBOARDING_BOOTSTRAP_RETRY_COUNT = 5;
const ONBOARDING_BOOTSTRAP_RETRY_DELAY_MS = 300;

let workspaceBootstrapRefreshPromise: Promise<WorkspaceBootstrapSnapshot> | null =
  null;

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
    markStartup("workspace.bootstrap:workspaces empty, retrying", {
      attempt,
      retryDelayMs: WORKSPACE_BOOTSTRAP_RETRY_DELAY_MS,
    });
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
    markStartup("workspace.bootstrap:onboarding null, retrying", {
      attempt,
      workspaceId,
      retryDelayMs: ONBOARDING_BOOTSTRAP_RETRY_DELAY_MS,
    });
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

async function refreshWorkspaceBootstrapSnapshot() {
  const workspaces = await measureStartup(
    "workspace.bootstrap:get workspaces",
    getUserWorkspacesWithBootstrapRetry,
  );
  const onboardingWorkspace = getEarliestOwnedWorkspace(workspaces);
  const onboardingByWorkspaceId: WorkspaceBootstrapSnapshot["onboardingByWorkspaceId"] =
    {};

  if (onboardingWorkspace) {
    onboardingByWorkspaceId[onboardingWorkspace.id] = await measureStartup(
      "workspace.bootstrap:get onboarding",
      () => getOnboardingStateWithBootstrapRetry(onboardingWorkspace.id),
    );
  }

  const snapshot = {
    workspaces,
    onboardingByWorkspaceId,
  };

  writeWorkspaceBootstrapCache(snapshot);
  return snapshot;
}

function getSharedWorkspaceBootstrapRefreshPromise() {
  if (!workspaceBootstrapRefreshPromise) {
    workspaceBootstrapRefreshPromise = refreshWorkspaceBootstrapSnapshot()
      .then((snapshot) => {
        markStartup("workspace.bootstrap:refresh resolved", {
          workspaceCount: snapshot.workspaces.length,
        });
        return snapshot;
      })
      .finally(() => {
        workspaceBootstrapRefreshPromise = null;
      });
  }

  return workspaceBootstrapRefreshPromise;
}

function applyWorkspaceBootstrapSnapshot(
  snapshot: WorkspaceBootstrapSnapshot,
  source: "cache" | "network",
) {
  queryClient.setQueryData(["user-workspaces"], snapshot.workspaces);

  for (const [workspaceId, onboarding] of Object.entries(
    snapshot.onboardingByWorkspaceId,
  )) {
    queryClient.setQueryData(["workspace-onboarding", workspaceId], onboarding);
  }

  const activeWorkspaceId = getActiveWorkspaceId(snapshot.workspaces);
  const onboardingWorkspace = getEarliestOwnedWorkspace(snapshot.workspaces);
  const onboarding = onboardingWorkspace
    ? (snapshot.onboardingByWorkspaceId[onboardingWorkspace.id] ?? null)
    : null;
  const onboardingRequired = isOnboardingRequired(onboarding);
  const sessionWorkspaceId = getSessionWorkspaceId({
    activeWorkspaceId,
    onboardingWorkspaceId: onboardingWorkspace?.id ?? null,
    onboardingRequired,
  });

  if (sessionWorkspaceId) {
    workspaceActions.setSelectedWorkspaceId(sessionWorkspaceId);
  }

  markStartup("workspace.bootstrap:applied", {
    source,
    workspaceCount: snapshot.workspaces.length,
    sessionWorkspaceId,
    onboardingRequired,
  });

  return {
    onboarding,
    onboardingRequired,
    onboardingWorkspace,
    sessionWorkspaceId,
  };
}

export function useWorkspaceBootstrap() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const initialPathname = window.location.pathname;

    const maybeNavigate = (
      result: ReturnType<typeof applyWorkspaceBootstrapSnapshot>,
    ) => {
      if (cancelled) {
        return;
      }

      if (
        result.sessionWorkspaceId &&
        result.onboardingRequired &&
        result.onboardingWorkspace &&
        result.onboarding &&
        initialPathname !== ONBOARDING_ROUTE
      ) {
        void navigate({
          to: ONBOARDING_ROUTE,
          search: {
            workspaceId: result.onboardingWorkspace.id,
            step: result.onboarding.currentStep,
          },
          replace: true,
        });
        return;
      }

      if (
        result.sessionWorkspaceId &&
        initialPathname === ONBOARDING_ROUTE &&
        !result.onboardingRequired
      ) {
        void navigate({ to: "/", replace: true });
        return;
      }

      if (!result.sessionWorkspaceId && initialPathname === ONBOARDING_ROUTE) {
        void navigate({ to: "/", replace: true });
      }
    };

    const cached = readWorkspaceBootstrapCache();
    if (cached) {
      maybeNavigate(applyWorkspaceBootstrapSnapshot(cached, "cache"));
    }

    void getSharedWorkspaceBootstrapRefreshPromise()
      .then((snapshot) => {
        maybeNavigate(applyWorkspaceBootstrapSnapshot(snapshot, "network"));
      })
      .catch((error) => {
        markStartup("workspace.bootstrap:refresh failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);
}
