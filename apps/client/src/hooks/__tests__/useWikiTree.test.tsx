import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeEntryDto } from "@/types/wiki";

const mockWikisApi = vi.hoisted(() => ({
  getTree: vi.fn(),
}));

vi.mock("@/services/api/wikis", () => ({
  wikisApi: mockWikisApi,
}));

import { useWikiTree } from "../useWikiTree";

const tree: TreeEntryDto[] = [
  { name: "intro.md", path: "/intro.md", type: "file", size: 1 },
];

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("useWikiTree", () => {
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
    const { result } = renderHook(() => useWikiTree(null), {
      wrapper: wrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockWikisApi.getTree).not.toHaveBeenCalled();
  });

  it("fetches recursive tree when wikiId is present", async () => {
    mockWikisApi.getTree.mockResolvedValue(tree);

    const { result } = renderHook(() => useWikiTree("wiki-1"), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual(tree));
    expect(mockWikisApi.getTree).toHaveBeenCalledWith("wiki-1", {
      path: "/",
      recursive: true,
    });
  });

  it("forwards a non-default path", async () => {
    mockWikisApi.getTree.mockResolvedValue(tree);

    const { result } = renderHook(() => useWikiTree("wiki-1", "/docs"), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual(tree));
    expect(mockWikisApi.getTree).toHaveBeenCalledWith("wiki-1", {
      path: "/docs",
      recursive: true,
    });
  });
});
