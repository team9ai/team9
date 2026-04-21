import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitPageResponse, PageDto } from "@/types/wiki";

const mockWikisApi = vi.hoisted(() => ({
  getPage: vi.fn(),
  commit: vi.fn(),
}));

vi.mock("@/services/api/wikis", () => ({
  wikisApi: mockWikisApi,
}));

import { useCommitWikiPage, useWikiPage } from "../useWikiPage";
import { wikiKeys } from "../useWikis";

const page: PageDto = {
  path: "/intro.md",
  content: "hi",
  frontmatter: {},
  lastCommit: null,
};

const commitResult: CommitPageResponse = {
  commit: { sha: "sha-1" },
  proposal: null,
};

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("useWikiPage", () => {
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
    const { result } = renderHook(() => useWikiPage(null, "/intro.md"), {
      wrapper: wrapper(),
    });
    expect(result.current.isFetching).toBe(false);
    expect(mockWikisApi.getPage).not.toHaveBeenCalled();
  });

  it("is disabled when path is null", () => {
    const { result } = renderHook(() => useWikiPage("wiki-1", null), {
      wrapper: wrapper(),
    });
    expect(result.current.isFetching).toBe(false);
    expect(mockWikisApi.getPage).not.toHaveBeenCalled();
  });

  it("fetches the page when both args are present", async () => {
    mockWikisApi.getPage.mockResolvedValue(page);

    const { result } = renderHook(() => useWikiPage("wiki-1", "/intro.md"), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual(page));
    expect(mockWikisApi.getPage).toHaveBeenCalledWith("wiki-1", "/intro.md");
  });
});

describe("useCommitWikiPage", () => {
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

  it("invalidates tree and each affected page path", async () => {
    mockWikisApi.commit.mockResolvedValue(commitResult);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCommitWikiPage("wiki-1"), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        message: "update",
        files: [
          { path: "/intro.md", content: "hi", action: "update" },
          { path: "/second.md", content: "there", action: "create" },
        ],
      });
    });

    expect(mockWikisApi.commit).toHaveBeenCalledWith("wiki-1", {
      message: "update",
      files: [
        { path: "/intro.md", content: "hi", action: "update" },
        { path: "/second.md", content: "there", action: "create" },
      ],
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.trees("wiki-1"),
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.page("wiki-1", "/intro.md"),
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.page("wiki-1", "/second.md"),
    });
  });
});
