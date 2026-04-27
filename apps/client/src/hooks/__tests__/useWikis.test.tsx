import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WikiDto } from "@/types/wiki";

const mockWikisApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  getTree: vi.fn(),
  getPage: vi.fn(),
  commit: vi.fn(),
  listProposals: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  getPendingCounts: vi.fn(),
}));

vi.mock("@/services/api/wikis", () => ({
  wikisApi: mockWikisApi,
}));

import {
  useArchiveWiki,
  useCreateWiki,
  useUpdateWiki,
  useWikiPendingCounts,
  useWikis,
  wikiKeys,
} from "../useWikis";

const wiki: WikiDto = {
  id: "wiki-1",
  workspaceId: "ws-1",
  name: "Handbook",
  slug: "handbook",
  icon: null,
  approvalMode: "auto",
  humanPermission: "write",
  agentPermission: "read",
  createdBy: "user-1",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
};

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("useWikis hooks", () => {
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

  it("wikiKeys produces the documented shapes", () => {
    expect(wikiKeys.all).toEqual(["wikis"]);
    expect(wikiKeys.detail("wiki-1")).toEqual(["wikis", "wiki-1"]);
    expect(wikiKeys.trees("wiki-1")).toEqual(["wikis", "wiki-1", "tree"]);
    expect(wikiKeys.tree("wiki-1", "/")).toEqual([
      "wikis",
      "wiki-1",
      "tree",
      "/",
    ]);
    expect(wikiKeys.pages("wiki-1")).toEqual(["wikis", "wiki-1", "page"]);
    expect(wikiKeys.page("wiki-1", "/x.md")).toEqual([
      "wikis",
      "wiki-1",
      "page",
      "/x.md",
    ]);
    expect(wikiKeys.proposals("wiki-1")).toEqual([
      "wikis",
      "wiki-1",
      "proposals",
    ]);
    expect(wikiKeys.proposals("wiki-1", "pending")).toEqual([
      "wikis",
      "wiki-1",
      "proposals",
      "pending",
    ]);
    expect(wikiKeys.pendingCounts()).toEqual(["wikis", "pending-counts"]);
  });

  it("useWikis fetches and returns the list", async () => {
    mockWikisApi.list.mockResolvedValue([wiki]);
    const { result } = renderHook(() => useWikis(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual([wiki]));
    expect(mockWikisApi.list).toHaveBeenCalledTimes(1);
  });

  it("useCreateWiki invalidates the list on success", async () => {
    mockWikisApi.create.mockResolvedValue(wiki);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateWiki(), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ name: "Handbook" });
    });

    expect(mockWikisApi.create).toHaveBeenCalledWith({ name: "Handbook" });
    expect(spy).toHaveBeenCalledWith({ queryKey: wikiKeys.all });
  });

  it("useUpdateWiki invalidates list + detail on success", async () => {
    mockWikisApi.update.mockResolvedValue(wiki);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateWiki("wiki-1"), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ name: "Renamed" });
    });

    expect(mockWikisApi.update).toHaveBeenCalledWith("wiki-1", {
      name: "Renamed",
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: wikiKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: wikiKeys.detail("wiki-1") });
  });

  it("useArchiveWiki invalidates the list on success", async () => {
    mockWikisApi.archive.mockResolvedValue(undefined);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useArchiveWiki(), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("wiki-1");
    });

    expect(mockWikisApi.archive).toHaveBeenCalledWith("wiki-1");
    expect(spy).toHaveBeenCalledWith({ queryKey: wikiKeys.all });
  });

  describe("useWikiPendingCounts", () => {
    it("fetches and returns the aggregated counts envelope", async () => {
      const payload = { counts: { "wiki-1": 2, "wiki-2": 0 } };
      mockWikisApi.getPendingCounts.mockResolvedValue(payload);

      const { result } = renderHook(() => useWikiPendingCounts(), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.data).toEqual(payload));
      expect(mockWikisApi.getPendingCounts).toHaveBeenCalledTimes(1);
    });

    it("returns undefined data while the request is pending and surfaces errors", async () => {
      mockWikisApi.getPendingCounts.mockRejectedValueOnce(new Error("boom"));
      const { result } = renderHook(() => useWikiPendingCounts(), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data).toBeUndefined();
    });
  });
});
