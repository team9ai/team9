import { describe, expect, it } from "vitest";
import {
  getEarliestOwnedWorkspace,
  getSessionWorkspaceId,
  isOnboardingRequired,
} from "../onboarding-gate";
import type { UserWorkspace, WorkspaceOnboarding } from "@/types/workspace";

const workspaces: UserWorkspace[] = [
  {
    id: "member-ws",
    name: "Member Workspace",
    slug: "member-workspace",
    role: "member",
    joinedAt: "2026-04-01T00:00:00.000Z",
  },
  {
    id: "owner-later",
    name: "Owner Later",
    slug: "owner-later",
    role: "owner",
    joinedAt: "2026-04-03T00:00:00.000Z",
  },
  {
    id: "owner-earliest",
    name: "Owner Earliest",
    slug: "owner-earliest",
    role: "owner",
    joinedAt: "2026-04-02T00:00:00.000Z",
  },
];

describe("onboarding gate helpers", () => {
  it("picks the earliest owned workspace", () => {
    expect(getEarliestOwnedWorkspace(workspaces)?.id).toBe("owner-earliest");
  });

  it("treats in-progress onboarding as required", () => {
    const onboarding = {
      id: "onboarding-1",
      tenantId: "owner-earliest",
      userId: "user-1",
      status: "in_progress",
      currentStep: 2,
      stepData: {},
      version: 1,
      completedAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    } satisfies WorkspaceOnboarding;

    expect(isOnboardingRequired(onboarding)).toBe(true);
  });

  it("keeps the active workspace when onboarding is not required", () => {
    expect(
      getSessionWorkspaceId({
        activeWorkspaceId: "member-ws",
        onboardingWorkspaceId: "owner-earliest",
        onboardingRequired: false,
      }),
    ).toBe("member-ws");
  });

  it("switches to the onboarding workspace when onboarding is required", () => {
    expect(
      getSessionWorkspaceId({
        activeWorkspaceId: "member-ws",
        onboardingWorkspaceId: "owner-earliest",
        onboardingRequired: true,
      }),
    ).toBe("owner-earliest");
  });
});
