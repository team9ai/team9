import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposalDto } from "@/types/wiki";

const mockWikisApi = vi.hoisted(() => ({
  listProposals: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
}));

vi.mock("@/services/api/wikis", () => ({
  wikisApi: mockWikisApi,
}));

import {
  useApproveProposal,
  useRejectProposal,
  useWikiProposals,
} from "../useWikiProposals";
import { wikiKeys } from "../useWikis";

const proposals: ProposalDto[] = [
  {
    id: "p-1",
    wikiId: "wiki-1",
    title: "Add page",
    description: "",
    status: "pending",
    authorId: "user-2",
    authorType: "user",
    createdAt: "2026-04-02T00:00:00.000Z",
    reviewedBy: null,
    reviewedAt: null,
  },
];

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("useWikiProposals", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = makeClient();
  });

  const wrapper =
    () =>
    ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

  it("is disabled when wikiId is null", () => {
    const { result } = renderHook(() => useWikiProposals(null), {
      wrapper: wrapper(),
    });
    expect(result.current.isFetching).toBe(false);
    expect(mockWikisApi.listProposals).not.toHaveBeenCalled();
  });

  it("fetches pending proposals by default", async () => {
    mockWikisApi.listProposals.mockResolvedValue(proposals);

    const { result } = renderHook(() => useWikiProposals("wiki-1"), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual(proposals));
    expect(mockWikisApi.listProposals).toHaveBeenCalledWith(
      "wiki-1",
      "pending",
    );
  });

  it("fetches proposals with an explicit status", async () => {
    mockWikisApi.listProposals.mockResolvedValue(proposals);

    const { result } = renderHook(
      () => useWikiProposals("wiki-1", "approved"),
      {
        wrapper: wrapper(),
      },
    );

    await waitFor(() => expect(result.current.data).toEqual(proposals));
    expect(mockWikisApi.listProposals).toHaveBeenCalledWith(
      "wiki-1",
      "approved",
    );
  });
});

describe("useApproveProposal", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = makeClient();
  });

  const wrapper =
    () =>
    ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

  it("invalidates proposals on success", async () => {
    mockWikisApi.approveProposal.mockResolvedValue(undefined);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useApproveProposal("wiki-1"), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("p-1");
    });

    expect(mockWikisApi.approveProposal).toHaveBeenCalledWith("wiki-1", "p-1");
    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.proposals("wiki-1"),
    });
  });
});

describe("useRejectProposal", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = makeClient();
  });

  const wrapper =
    () =>
    ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

  it("rejects without reason", async () => {
    mockWikisApi.rejectProposal.mockResolvedValue(undefined);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRejectProposal("wiki-1"), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ proposalId: "p-1" });
    });

    expect(mockWikisApi.rejectProposal).toHaveBeenCalledWith(
      "wiki-1",
      "p-1",
      undefined,
    );
    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.proposals("wiki-1"),
    });
  });

  it("rejects with a reason", async () => {
    mockWikisApi.rejectProposal.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRejectProposal("wiki-1"), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ proposalId: "p-1", reason: "nope" });
    });

    expect(mockWikisApi.rejectProposal).toHaveBeenCalledWith(
      "wiki-1",
      "p-1",
      "nope",
    );
  });
});
