import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shim lives outside the mocked module so tests can reach into it and
// emit synthetic events. `vi.hoisted` runs before the module factories so
// the shim is ready when `@/services/websocket` is imported by the hook.
const wsEmitter = vi.hoisted(() => {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const on = vi.fn((event: string, handler: (data: unknown) => void) => {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(handler);
  });
  const off = vi.fn((event: string, handler?: (data: unknown) => void) => {
    if (!handler) {
      handlers.delete(event);
      return;
    }
    handlers.get(event)?.delete(handler);
  });
  const emit = (event: string, data: unknown) => {
    for (const handler of handlers.get(event) ?? new Set()) {
      handler(data);
    }
  };
  const clear = () => {
    handlers.clear();
    on.mockClear();
    off.mockClear();
  };
  const hasHandlerFor = (event: string) => (handlers.get(event)?.size ?? 0) > 0;
  return { on, off, emit, clear, hasHandlerFor };
});

vi.mock("@/services/websocket", () => ({
  default: {
    on: wsEmitter.on,
    off: wsEmitter.off,
  },
}));

import { useWikiWebSocketSync } from "../useWikiWebSocketSync";
import { wikiKeys } from "../useWikis";
import {
  submittedProposalKey,
  useWikiStore,
  wikiActions,
} from "@/stores/useWikiStore";

const WIKI_EVENTS = [
  "wiki_created",
  "wiki_updated",
  "wiki_archived",
  "wiki_page_updated",
  "wiki_proposal_created",
  "wiki_proposal_approved",
  "wiki_proposal_rejected",
] as const;

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useWikiWebSocketSync", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeClient();
    wsEmitter.clear();
  });

  afterEach(() => {
    act(() => {
      useWikiStore.getState().reset();
    });
  });

  it("subscribes to every wiki_* event on mount", () => {
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    for (const event of WIKI_EVENTS) {
      expect(wsEmitter.hasHandlerFor(event)).toBe(true);
    }
    // Each subscription uses the generic `on(event, handler)` form.
    expect(wsEmitter.on).toHaveBeenCalledTimes(WIKI_EVENTS.length);
  });

  it("unsubscribes every handler on unmount", () => {
    const { unmount } = renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    unmount();

    expect(wsEmitter.off).toHaveBeenCalledTimes(WIKI_EVENTS.length);
    for (const event of WIKI_EVENTS) {
      expect(wsEmitter.hasHandlerFor(event)).toBe(false);
    }
  });

  it.each([["wiki_created"], ["wiki_updated"], ["wiki_archived"]] as const)(
    "%s invalidates wikiKeys.all",
    (event) => {
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      renderHook(() => useWikiWebSocketSync(), {
        wrapper: makeWrapper(queryClient),
      });

      act(() => wsEmitter.emit(event, {}));

      expect(spy).toHaveBeenCalledWith({ queryKey: wikiKeys.all });
    },
  );

  it("wiki_page_updated invalidates trees + pages prefixes", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() =>
      wsEmitter.emit("wiki_page_updated", {
        wikiId: "wiki-1",
        ref: "refs/heads/main",
        sha: "abc123",
      }),
    );

    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.trees("wiki-1"),
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.pages("wiki-1"),
    });
  });

  it("wiki_page_updated ignores payloads without wikiId", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() => wsEmitter.emit("wiki_page_updated", { ref: "refs/heads/main" }));
    act(() => wsEmitter.emit("wiki_page_updated", null));

    expect(spy).not.toHaveBeenCalled();
  });

  it("wiki_proposal_created invalidates the proposals prefix", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() =>
      wsEmitter.emit("wiki_proposal_created", {
        wikiId: "wiki-1",
        proposalId: "p-1",
      }),
    );

    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.proposals("wiki-1"),
    });
  });

  it("wiki_proposal_created without wikiId is a no-op", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() => wsEmitter.emit("wiki_proposal_created", { proposalId: "p-1" }));

    expect(spy).not.toHaveBeenCalled();
  });

  it("wiki_proposal_approved invalidates proposals + pages and clears matching submittedProposals", () => {
    // Seed the wiki store with a submitted proposal so we can observe the
    // cleanup. A second entry with a different id must be preserved.
    act(() => {
      wikiActions.setSubmittedProposal("wiki-1", "api/auth.md", "p-1");
      wikiActions.setSubmittedProposal("wiki-1", "api/users.md", "p-2");
      // A third entry keyed on the SAME proposal id but a different path
      // verifies the defensive loop covers duplicate proposals.
      wikiActions.setSubmittedProposal("wiki-1", "guides/intro.md", "p-1");
    });

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() =>
      wsEmitter.emit("wiki_proposal_approved", {
        wikiId: "wiki-1",
        proposalId: "p-1",
      }),
    );

    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.proposals("wiki-1"),
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.pages("wiki-1"),
    });

    const map = useWikiStore.getState().submittedProposals;
    expect(map[submittedProposalKey("wiki-1", "api/auth.md")]).toBeUndefined();
    expect(
      map[submittedProposalKey("wiki-1", "guides/intro.md")],
    ).toBeUndefined();
    // Untouched: different proposal id.
    expect(map[submittedProposalKey("wiki-1", "api/users.md")]).toBe("p-2");
  });

  it("wiki_proposal_approved without proposalId still invalidates caches", () => {
    act(() => {
      wikiActions.setSubmittedProposal("wiki-1", "api/auth.md", "p-1");
    });

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() => wsEmitter.emit("wiki_proposal_approved", { wikiId: "wiki-1" }));

    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.proposals("wiki-1"),
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.pages("wiki-1"),
    });
    // Store entry preserved because we have no id to match against.
    expect(
      useWikiStore.getState().submittedProposals[
        submittedProposalKey("wiki-1", "api/auth.md")
      ],
    ).toBe("p-1");
  });

  it("wiki_proposal_approved without wikiId is a no-op", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() => wsEmitter.emit("wiki_proposal_approved", { proposalId: "p-1" }));

    expect(spy).not.toHaveBeenCalled();
  });

  it("wiki_proposal_rejected invalidates proposals and clears matching submittedProposals (not pages)", () => {
    act(() => {
      wikiActions.setSubmittedProposal("wiki-1", "api/auth.md", "p-1");
      wikiActions.setSubmittedProposal("wiki-1", "api/users.md", "p-2");
    });

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() =>
      wsEmitter.emit("wiki_proposal_rejected", {
        wikiId: "wiki-1",
        proposalId: "p-1",
      }),
    );

    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.proposals("wiki-1"),
    });
    // Rejection leaves the canonical branch untouched, so pages are NOT
    // invalidated — only the proposals cache.
    expect(spy).not.toHaveBeenCalledWith({
      queryKey: wikiKeys.pages("wiki-1"),
    });

    const map = useWikiStore.getState().submittedProposals;
    expect(map[submittedProposalKey("wiki-1", "api/auth.md")]).toBeUndefined();
    expect(map[submittedProposalKey("wiki-1", "api/users.md")]).toBe("p-2");
  });

  it("wiki_proposal_rejected without wikiId is a no-op", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() => wsEmitter.emit("wiki_proposal_rejected", { proposalId: "p-1" }));

    expect(spy).not.toHaveBeenCalled();
  });

  it("wiki_proposal_rejected without proposalId leaves the store untouched", () => {
    // When the server omits proposalId we can't figure out which store
    // entry to clear, so we must only invalidate the query cache — without
    // this branch coverage we'd quietly regress to clearing nothing and
    // also not invalidating.
    act(() => {
      wikiActions.setSubmittedProposal("wiki-1", "api/auth.md", "p-1");
    });

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() => wsEmitter.emit("wiki_proposal_rejected", { wikiId: "wiki-1" }));

    expect(spy).toHaveBeenCalledWith({
      queryKey: wikiKeys.proposals("wiki-1"),
    });
    expect(
      useWikiStore.getState().submittedProposals[
        submittedProposalKey("wiki-1", "api/auth.md")
      ],
    ).toBe("p-1");
  });

  it.each([
    ["wiki_page_updated"],
    ["wiki_proposal_created"],
    ["wiki_proposal_approved"],
    ["wiki_proposal_rejected"],
  ] as const)(
    "%s accepts null/undefined payloads without throwing",
    (event) => {
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      renderHook(() => useWikiWebSocketSync(), {
        wrapper: makeWrapper(queryClient),
      });

      // Emitting `null` and `undefined` exercises the `data ?? {}` fallback
      // that would otherwise crash on destructuring.
      expect(() => {
        act(() => wsEmitter.emit(event, null));
        act(() => wsEmitter.emit(event, undefined));
      }).not.toThrow();
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("skips malformed keys (no colon) without throwing or corrupting state", () => {
    // Directly inject a malformed key into the store to simulate a
    // corrupted or externally-modified store. The guard `if (colonIdx < 0)
    // continue` should skip this entry cleanly and still clear valid ones.
    act(() => {
      // Manually set a malformed key (no colon) via the raw store setter.
      useWikiStore.setState((s) => ({
        ...s,
        submittedProposals: {
          ...s.submittedProposals,
          malformedkeynocodon: "p-1",
        },
      }));
      // Also set a valid key for the same proposalId.
      wikiActions.setSubmittedProposal("wiki-1", "api/auth.md", "p-1");
    });

    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    expect(() => {
      act(() =>
        wsEmitter.emit("wiki_proposal_approved", {
          wikiId: "wiki-1",
          proposalId: "p-1",
        }),
      );
    }).not.toThrow();

    // Valid key should be cleared.
    expect(
      useWikiStore.getState().submittedProposals[
        submittedProposalKey("wiki-1", "api/auth.md")
      ],
    ).toBeUndefined();
    // Malformed key is untouched (skipped, not cleared).
    expect(
      useWikiStore.getState().submittedProposals["malformedkeynocodon"],
    ).toBe("p-1");
  });

  it("handles paths that contain slashes correctly when clearing store entries", () => {
    // Wiki paths commonly contain multiple slashes (e.g. `guides/setup/db.md`).
    // The composite key is `${wikiId}:${path}` — splitting on the FIRST colon
    // is required so deeply nested paths round-trip intact.
    act(() => {
      wikiActions.setSubmittedProposal(
        "wiki-1",
        "guides/setup/db.md",
        "p-nested",
      );
    });

    renderHook(() => useWikiWebSocketSync(), {
      wrapper: makeWrapper(queryClient),
    });

    act(() =>
      wsEmitter.emit("wiki_proposal_approved", {
        wikiId: "wiki-1",
        proposalId: "p-nested",
      }),
    );

    expect(
      useWikiStore.getState().submittedProposals[
        submittedProposalKey("wiki-1", "guides/setup/db.md")
      ],
    ).toBeUndefined();
  });
});
