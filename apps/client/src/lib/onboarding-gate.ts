import type {
  UserWorkspace,
  WorkspaceOnboarding,
  WorkspaceOnboardingStatus,
} from "@/types/workspace";

export const COMPLETED_ONBOARDING_STATUSES = new Set<WorkspaceOnboardingStatus>(
  ["provisioned", "skipped"],
);

export function getEarliestOwnedWorkspace(
  workspaces: UserWorkspace[],
): UserWorkspace | null {
  const ownedWorkspaces = workspaces.filter(
    (workspace) => workspace.role === "owner",
  );

  if (ownedWorkspaces.length === 0) {
    return null;
  }

  return [...ownedWorkspaces].sort(
    (left, right) =>
      new Date(left.joinedAt).getTime() - new Date(right.joinedAt).getTime(),
  )[0];
}

export function isOnboardingRequired(
  onboarding: WorkspaceOnboarding | null | undefined,
): onboarding is WorkspaceOnboarding {
  return Boolean(
    onboarding && !COMPLETED_ONBOARDING_STATUSES.has(onboarding.status),
  );
}

export function getSessionWorkspaceId(args: {
  activeWorkspaceId: string | null;
  onboardingWorkspaceId: string | null;
  onboardingRequired: boolean;
}) {
  return args.onboardingRequired
    ? args.onboardingWorkspaceId
    : args.activeWorkspaceId;
}
