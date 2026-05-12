import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STARTUP_REQUEST_RETRY_COUNT,
  useWorkspaceBootstrap,
} from "@/hooks/useWorkspaceBootstrap";
import { queryClient } from "@/lib/query-client";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockGetUserWorkspaces = vi.hoisted(() => vi.fn());
const mockGetOnboardingState = vi.hoisted(() => vi.fn());
const mockSetSelectedWorkspaceId = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/services/api/workspace", () => ({
  default: {
    getUserWorkspaces: mockGetUserWorkspaces,
    getOnboardingState: mockGetOnboardingState,
  },
}));

vi.mock("@/stores", () => ({
  workspaceActions: {
    setSelectedWorkspaceId: mockSetSelectedWorkspaceId,
  },
  useWorkspaceStore: {
    getState: () => ({ selectedWorkspaceId: null }),
  },
}));

vi.mock("@/lib/startup-profiler", () => ({
  markStartup: vi.fn(),
  measureStartup: async (_label: string, fn: () => Promise<unknown>) => fn(),
}));

const workspace = {
  id: "workspace-1",
  name: "Team9",
  slug: "team9",
  role: "owner" as const,
  joinedAt: "2026-05-12T09:00:00.000Z",
};

describe("useWorkspaceBootstrap", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    queryClient.clear();
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/channels/channel-1");
  });

  it("retries the workspace request and surfaces a non-throwing offline state", async () => {
    mockGetUserWorkspaces.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useWorkspaceBootstrap());

    await waitFor(() => {
      expect(mockGetUserWorkspaces).toHaveBeenCalledTimes(
        STARTUP_REQUEST_RETRY_COUNT,
      );
    });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });
    expect(result.current.errorMessage).toBe("offline");
  });

  it("retries the onboarding request and surfaces a non-throwing offline state", async () => {
    mockGetUserWorkspaces.mockResolvedValue([workspace]);
    mockGetOnboardingState.mockRejectedValue(new Error("onboarding offline"));

    const { result } = renderHook(() => useWorkspaceBootstrap());

    await waitFor(() => {
      expect(mockGetOnboardingState).toHaveBeenCalledTimes(
        STARTUP_REQUEST_RETRY_COUNT,
      );
    });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });
    expect(result.current.errorMessage).toBe("onboarding offline");
  });
});
