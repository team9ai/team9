import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mockQueryClient = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));
const mockUseQuery = vi.hoisted(() => vi.fn());
const capturedMutationOptions = vi.hoisted(() => ({
  current: undefined as
    | {
        mutationFn?: (variables: unknown) => Promise<unknown>;
        onSuccess?: () => void;
      }
    | undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mockQueryClient,
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (options: typeof capturedMutationOptions.current) => {
    capturedMutationOptions.current = options;
    return {
      mutateAsync: async (variables: unknown) =>
        options?.mutationFn?.(variables),
    };
  },
}));

const mockUseWorkspaceId = vi.hoisted(() => vi.fn());
vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: mockUseWorkspaceId,
}));

const mockGetRecommendedStaff = vi.hoisted(() => vi.fn());
const mockInstallRecommendedStaff = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({
  api: {
    agentHub: {
      getRecommendedStaff: mockGetRecommendedStaff,
      installRecommendedStaff: mockInstallRecommendedStaff,
    },
  },
}));

import {
  agentHubRecommendedStaffQueryKey,
  useInstallRecommendedStaff,
  useRecommendedStaff,
} from "../useAgentHub";

describe("useAgentHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedMutationOptions.current = undefined;
    mockUseQuery.mockReset();
    mockUseWorkspaceId.mockReturnValue("workspace-1");
  });

  it("disables the recommended staff query without a selected workspace", () => {
    mockUseWorkspaceId.mockReturnValue(null);

    renderHook(() => useRecommendedStaff());

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: agentHubRecommendedStaffQueryKey(null),
        enabled: false,
      }),
    );
  });

  it("fetches recommended staff with the selected workspace in the query key", async () => {
    let capturedQueryFn: (() => Promise<unknown>) | undefined;
    mockUseQuery.mockImplementation(
      ({
        queryFn,
      }: {
        queryKey?: unknown;
        queryFn?: () => Promise<unknown>;
        enabled?: boolean;
      }) => {
        capturedQueryFn = queryFn;
        return { data: undefined, isLoading: false };
      },
    );

    renderHook(() => useRecommendedStaff());

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["agent-hub-recommended-staff", "workspace-1"],
        enabled: true,
      }),
    );

    await capturedQueryFn?.();

    expect(mockGetRecommendedStaff).toHaveBeenCalledTimes(1);
  });

  it("installs recommended staff and invalidates AgentHub and installed app queries", async () => {
    renderHook(() => useInstallRecommendedStaff());

    await capturedMutationOptions.current?.mutationFn?.({
      templateId: "sales-analyst",
      body: { mentorId: "mentor-1" },
    });

    expect(mockInstallRecommendedStaff).toHaveBeenCalledWith("sales-analyst", {
      mentorId: "mentor-1",
    });

    capturedMutationOptions.current?.onSuccess?.();

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["agent-hub-recommended-staff", "workspace-1"],
    });
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["installed-applications-with-bots", "workspace-1"],
    });
  });
});
