import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_BOOTSTRAP_CACHE_TTL_MS,
  readWorkspaceBootstrapCache,
  writeWorkspaceBootstrapCache,
} from "@/lib/workspace-bootstrap-cache";

const now = new Date("2026-05-12T10:00:00.000Z").getTime();

const snapshot = {
  workspaces: [
    {
      id: "workspace-1",
      name: "Team9",
      slug: "team9",
      role: "owner" as const,
      joinedAt: "2026-05-12T09:00:00.000Z",
    },
  ],
  onboardingByWorkspaceId: {
    "workspace-1": {
      id: "onboarding-1",
      tenantId: "workspace-1",
      userId: "user-1",
      status: "provisioned" as const,
      currentStep: 6,
      stepData: {},
      version: 1,
      completedAt: "2026-05-12T09:30:00.000Z",
      createdAt: "2026-05-12T09:00:00.000Z",
      updatedAt: "2026-05-12T09:30:00.000Z",
    },
  },
};

describe("workspace bootstrap cache", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.setSystemTime(now);
  });

  it("returns a cached bootstrap snapshot before it expires", () => {
    writeWorkspaceBootstrapCache(snapshot);

    vi.setSystemTime(now + WORKSPACE_BOOTSTRAP_CACHE_TTL_MS - 1);

    expect(readWorkspaceBootstrapCache()).toEqual(snapshot);
  });

  it("expires cached bootstrap snapshots and removes stale storage", () => {
    writeWorkspaceBootstrapCache(snapshot);

    vi.setSystemTime(now + WORKSPACE_BOOTSTRAP_CACHE_TTL_MS + 1);

    expect(readWorkspaceBootstrapCache()).toBeNull();
    expect(
      localStorage.getItem("team9_workspace_bootstrap_cache_v1"),
    ).toBeNull();
  });
});
