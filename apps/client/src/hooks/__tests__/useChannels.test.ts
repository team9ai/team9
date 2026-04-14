import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mockUseQuery = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/stores", () => ({
  useSelectedWorkspaceId: () => "workspace-1",
}));

vi.mock("@/services/api/im", () => ({
  default: {
    channels: {
      getChannels: vi.fn(),
    },
  },
}));

import { useChannelsByType } from "@/hooks/useChannels";

describe("useChannelsByType", () => {
  it("excludes routine-session channels from every grouped output", () => {
    mockUseQuery.mockReturnValue({
      data: [
        {
          id: "ch-rs",
          type: "routine-session",
          isArchived: false,
          showInDmSidebar: true,
        },
        {
          id: "ch-direct",
          type: "direct",
          isArchived: false,
          showInDmSidebar: true,
        },
        {
          id: "ch-public",
          type: "public",
          isArchived: false,
        },
        {
          id: "ch-private",
          type: "private",
          isArchived: false,
        },
      ],
      isLoading: false,
    });

    const { result } = renderHook(() => useChannelsByType());

    expect(
      result.current.directChannels.find((c) => c.id === "ch-rs"),
    ).toBeUndefined();
    expect(
      result.current.publicChannels.find((c) => c.id === "ch-rs"),
    ).toBeUndefined();
    expect(
      result.current.privateChannels.find((c) => c.id === "ch-rs"),
    ).toBeUndefined();
    expect(
      result.current.allDirectChannels.find((c) => c.id === "ch-rs"),
    ).toBeUndefined();

    // sanity: normal channels still appear
    expect(
      result.current.directChannels.find((c) => c.id === "ch-direct"),
    ).toBeDefined();
    expect(
      result.current.publicChannels.find((c) => c.id === "ch-public"),
    ).toBeDefined();
    expect(
      result.current.privateChannels.find((c) => c.id === "ch-private"),
    ).toBeDefined();
  });
});
