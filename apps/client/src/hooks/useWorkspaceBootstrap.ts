import { useCallback, useEffect, useState } from "react";
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
export const STARTUP_REQUEST_RETRY_COUNT = 3;
const STARTUP_REQUEST_RETRY_DELAY_MS = 300;
const WORKSPACE_BOOTSTRAP_RETRY_COUNT = 5;
const WORKSPACE_BOOTSTRAP_RETRY_DELAY_MS = 300;
const ONBOARDING_BOOTSTRAP_RETRY_COUNT = 5;
const ONBOARDING_BOOTSTRAP_RETRY_DELAY_MS = 300;

let workspaceBootstrapRefreshPromise: Promise<WorkspaceBootstrapSnapshot> | null =
  null;

export type WorkspaceBootstrapStatus =
  | "refreshing"
  | "retrying"
  | "ready"
  | "degraded"
  | "failed";

export interface WorkspaceBootstrapState {
  status: WorkspaceBootstrapStatus;
  errorMessage: string | null;
  retry: () => void;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function withStartupRequestRetry<T>(
  label: string,
  request: () => Promise<T>,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= STARTUP_REQUEST_RETRY_COUNT; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;

      if (attempt >= STARTUP_REQUEST_RETRY_COUNT) {
        break;
      }

      markStartup(`${label}:request failed, retrying`, {
        attempt,
        maxAttempts: STARTUP_REQUEST_RETRY_COUNT,
        retryDelayMs: STARTUP_REQUEST_RETRY_DELAY_MS,
        message: getErrorMessage(error),
      });
      await wait(STARTUP_REQUEST_RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

async function fetchUserWorkspaces() {
  const workspaces = await withStartupRequestRetry(
    "workspace.bootstrap:workspaces",
    workspaceApi.getUserWorkspaces,
  );
  queryClient.setQueryData(["user-workspaces"], workspaces);
  return workspaces;
}

async function fetchOnboardingState(workspaceId: string) {
  const onboarding = await withStartupRequestRetry(
    "workspace.bootstrap:onboarding",
    () => workspaceApi.getOnboardingState(workspaceId),
  );
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
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [state, setState] = useState<Omit<WorkspaceBootstrapState, "retry">>({
    status: "refreshing",
    errorMessage: null,
  });

  const retry = useCallback(() => {
    setState({ status: "retrying", errorMessage: null });
    setRetryAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let appliedSnapshot = false;
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
      appliedSnapshot = true;
      maybeNavigate(applyWorkspaceBootstrapSnapshot(cached, "cache"));
      setState({ status: "ready", errorMessage: null });
    }

    void getSharedWorkspaceBootstrapRefreshPromise()
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        appliedSnapshot = true;
        maybeNavigate(applyWorkspaceBootstrapSnapshot(snapshot, "network"));
        setState({ status: "ready", errorMessage: null });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const errorMessage = getErrorMessage(error);
        markStartup("workspace.bootstrap:refresh failed", {
          message: errorMessage,
        });
        setState({
          status: appliedSnapshot ? "degraded" : "failed",
          errorMessage,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, retryAttempt]);

  return {
    ...state,
    retry,
  };
}
