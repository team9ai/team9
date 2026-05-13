import type { UserWorkspace, WorkspaceOnboarding } from "@/types/workspace";

export const WORKSPACE_BOOTSTRAP_CACHE_KEY =
  "team9_workspace_bootstrap_cache_v1";
export const WORKSPACE_BOOTSTRAP_CACHE_TTL_MS = 5 * 60 * 1000;

export interface WorkspaceBootstrapSnapshot {
  workspaces: UserWorkspace[];
  onboardingByWorkspaceId: Record<string, WorkspaceOnboarding | null>;
}

interface WorkspaceBootstrapCacheEnvelope extends WorkspaceBootstrapSnapshot {
  expiresAt: number;
}

function getStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function isWorkspaceBootstrapSnapshot(
  value: unknown,
): value is WorkspaceBootstrapSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkspaceBootstrapSnapshot>;
  return (
    Array.isArray(candidate.workspaces) &&
    typeof candidate.onboardingByWorkspaceId === "object" &&
    candidate.onboardingByWorkspaceId !== null
  );
}

export function readWorkspaceBootstrapCache(): WorkspaceBootstrapSnapshot | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(WORKSPACE_BOOTSTRAP_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as WorkspaceBootstrapCacheEnvelope;
    if (
      !isWorkspaceBootstrapSnapshot(parsed) ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      storage.removeItem(WORKSPACE_BOOTSTRAP_CACHE_KEY);
      return null;
    }

    return {
      workspaces: parsed.workspaces,
      onboardingByWorkspaceId: parsed.onboardingByWorkspaceId,
    };
  } catch {
    storage.removeItem(WORKSPACE_BOOTSTRAP_CACHE_KEY);
    return null;
  }
}

export function writeWorkspaceBootstrapCache(
  snapshot: WorkspaceBootstrapSnapshot,
  ttlMs = WORKSPACE_BOOTSTRAP_CACHE_TTL_MS,
): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      WORKSPACE_BOOTSTRAP_CACHE_KEY,
      JSON.stringify({
        ...snapshot,
        expiresAt: Date.now() + ttlMs,
      } satisfies WorkspaceBootstrapCacheEnvelope),
    );
  } catch {
    // Storage quota/private-mode failures should not block startup.
  }
}

export function clearWorkspaceBootstrapCache(): void {
  getStorage()?.removeItem(WORKSPACE_BOOTSTRAP_CACHE_KEY);
}
