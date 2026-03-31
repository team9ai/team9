import { act, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateWorkspaceDto, WorkspaceResponse } from "@/types/workspace";

const workspaceDetail: WorkspaceResponse = {
  id: "ws-1",
  name: "Weight Wave",
  slug: "weight-wave",
  domain: null,
  logoUrl: "https://cdn.example.com/logo.png",
  plan: "free",
  isActive: true,
  createdAt: "2026-03-31T00:00:00.000Z",
  updatedAt: "2026-03-31T00:00:00.000Z",
};

const updatedWorkspace: WorkspaceResponse = {
  ...workspaceDetail,
  name: "Renamed Workspace",
  slug: "renamed-workspace",
  updatedAt: "2026-03-31T01:00:00.000Z",
};

const mockWorkspaceApi = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
}));

vi.mock("@/services/api/workspace", () => ({
  default: mockWorkspaceApi,
}));

import { useUpdateWorkspace, useWorkspace } from "../useWorkspace";

function createTestClient(config?: QueryClientConfig) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
    ...config,
  });
}

describe("useWorkspace", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestClient();
  });

  const createWrapper = () => {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    };
  };

  it("loads full workspace details", async () => {
    mockWorkspaceApi.getWorkspace.mockResolvedValue(workspaceDetail);

    const { result } = renderHook(() => useWorkspace("ws-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual(workspaceDetail));

    expect(mockWorkspaceApi.getWorkspace).toHaveBeenCalledWith("ws-1");
  });

  it("updates workspace and invalidates workspace queries", async () => {
    mockWorkspaceApi.updateWorkspace.mockResolvedValue(updatedWorkspace);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId: "ws-1",
        data: {
          name: "Renamed Workspace",
          slug: "renamed-workspace",
          logoUrl: "https://cdn.example.com/logo.png",
        } satisfies UpdateWorkspaceDto,
      });
    });

    expect(mockWorkspaceApi.updateWorkspace).toHaveBeenCalledWith("ws-1", {
      name: "Renamed Workspace",
      slug: "renamed-workspace",
      logoUrl: "https://cdn.example.com/logo.png",
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["user-workspaces"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["workspace", "ws-1"],
    });
  });
});
