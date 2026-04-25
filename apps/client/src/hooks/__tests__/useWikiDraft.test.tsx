import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseCurrentUser = vi.hoisted(() => vi.fn());
const mockUseWorkspaceStore = vi.hoisted(() => vi.fn());

// Mock both external hooks so the test never touches real react-query or
// zustand-persist plumbing. `useWorkspaceStore` in the hook is called with
// a selector; the mock ignores the selector and returns the
// mockWorkspaceId directly (we only read `selectedWorkspaceId`).
vi.mock("../useAuth", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: (
    selector: (state: { selectedWorkspaceId: string | null }) => unknown,
  ) => selector({ selectedWorkspaceId: mockUseWorkspaceStore() }),
}));

import {
  buildDraftKey,
  useWikiDraft,
  type WikiDraftServerSnapshot,
} from "../useWikiDraft";

const USER = { id: "user-1" };
const WORKSPACE = "ws-1";

const snapshot: WikiDraftServerSnapshot = {
  body: "server body",
  frontmatter: { title: "Server" },
  lastCommitTime: "2026-04-10T00:00:00.000Z",
};

const SERVER_EPOCH = new Date(snapshot.lastCommitTime!).getTime();

describe("buildDraftKey", () => {
  it("includes workspace, wiki, base64(path), and userId", () => {
    const key = buildDraftKey("u-1", "ws-1", "wiki-1", "docs/index.md");
    const pathB64 = btoa(
      String.fromCharCode(...new TextEncoder().encode("docs/index.md")),
    );
    expect(key).toBe(`team9.wiki.draft.ws-1.wiki-1.${pathB64}.u-1`);
  });

  it("produces different keys per user / workspace / wiki / path axis", () => {
    const base = buildDraftKey("u-1", "ws-1", "wiki-1", "a.md");
    expect(buildDraftKey("u-2", "ws-1", "wiki-1", "a.md")).not.toBe(base);
    expect(buildDraftKey("u-1", "ws-2", "wiki-1", "a.md")).not.toBe(base);
    expect(buildDraftKey("u-1", "ws-1", "wiki-2", "a.md")).not.toBe(base);
    expect(buildDraftKey("u-1", "ws-1", "wiki-1", "b.md")).not.toBe(base);
  });

  it("survives unicode/non-ascii paths", () => {
    // Must not throw — btoa of raw unicode would.
    expect(() =>
      buildDraftKey("u", "w", "wiki", "docs/中文/ページ.md"),
    ).not.toThrow();
  });
});

describe("useWikiDraft", () => {
  beforeEach(() => {
    mockUseCurrentUser.mockReturnValue({ data: USER });
    mockUseWorkspaceStore.mockReturnValue(WORKSPACE);
    localStorage.clear();
  });

  afterEach(() => {
    if (vi.isFakeTimers()) vi.useRealTimers();
    localStorage.clear();
    // Keep the default implementations between tests — `mockClear` wipes
    // call records without touching `mockReturnValue`, which prevents
    // late-firing effects during test teardown from seeing `undefined`.
    mockUseCurrentUser.mockClear();
    mockUseWorkspaceStore.mockClear();
  });

  it("returns a disabled hook (null draft) when no current user", () => {
    mockUseCurrentUser.mockReturnValue({ data: null });
    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );
    expect(result.current.draft).toBeNull();
    expect(result.current.isDirty).toBe(false);
    expect(result.current.hasStaleAlert).toBe(false);

    // setDraft is a no-op when no key — doesn't throw, doesn't persist.
    act(() => {
      result.current.setDraft({ body: "x", frontmatter: {} });
    });
    expect(localStorage.length).toBe(0);

    // clearDraft with no key also must not throw (no storage to remove).
    expect(() => {
      act(() => result.current.clearDraft());
    }).not.toThrow();
  });

  it("returns a disabled hook when no workspace is selected", () => {
    mockUseWorkspaceStore.mockReturnValue(null);
    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );
    expect(result.current.draft).toBeNull();
  });

  it("no-ops when wikiId or path is null", () => {
    const { result, rerender } = renderHook(
      ({ w, p }: { w: string | null; p: string | null }) =>
        useWikiDraft(w, p, snapshot),
      { initialProps: { w: null, p: null } },
    );
    expect(result.current.draft).toBeNull();
    rerender({ w: "wiki-1", p: null });
    expect(result.current.draft).toBeNull();
    rerender({ w: null, p: "a.md" });
    expect(result.current.draft).toBeNull();
  });

  it("no-ops when serverSnapshot is null (still loading)", () => {
    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", null),
    );
    expect(result.current.draft).toBeNull();
    expect(result.current.hasStaleAlert).toBe(false);
  });

  it("writes draft to localStorage after 500ms debounce", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );

    act(() => {
      result.current.setDraft({ body: "hi", frontmatter: { a: 1 } });
    });

    // In-memory draft is immediately dirty.
    expect(result.current.isDirty).toBe(true);
    expect(result.current.draft?.body).toBe("hi");

    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    // Not yet persisted.
    expect(localStorage.getItem(key)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    const persisted = localStorage.getItem(key);
    expect(persisted).not.toBeNull();
    const parsed = JSON.parse(persisted!);
    expect(parsed.body).toBe("hi");
    expect(parsed.frontmatter).toEqual({ a: 1 });
    expect(typeof parsed.savedAt).toBe("number");
  });

  it("coalesces rapid setDraft calls — only the latest payload is persisted", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );

    act(() => {
      result.current.setDraft({ body: "one", frontmatter: {} });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      result.current.setDraft({ body: "two", frontmatter: {} });
    });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    // Still not persisted — timer was reset by second call.
    expect(localStorage.getItem(key)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const parsed = JSON.parse(localStorage.getItem(key)!);
    expect(parsed.body).toBe("two");
  });

  it("loads an existing draft on mount and raises stale-alert when newer than server", () => {
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    const newerDraft = {
      body: "local edits",
      frontmatter: { x: true },
      savedAt: SERVER_EPOCH + 10_000,
    };
    localStorage.setItem(key, JSON.stringify(newerDraft));

    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );

    expect(result.current.draft).toEqual(newerDraft);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.hasStaleAlert).toBe(true);
  });

  it("silently discards a draft older than the latest commit", () => {
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    const olderDraft = {
      body: "old",
      frontmatter: {},
      savedAt: SERVER_EPOCH - 60_000,
    };
    localStorage.setItem(key, JSON.stringify(olderDraft));

    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );

    expect(result.current.draft).toBeNull();
    expect(result.current.hasStaleAlert).toBe(false);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("treats lastCommitTime=null as epoch 0 (any draft wins, stale-alert raised)", () => {
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    const draft = { body: "d", frontmatter: {}, savedAt: 100 };
    localStorage.setItem(key, JSON.stringify(draft));

    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", {
        body: "",
        frontmatter: {},
        lastCommitTime: null,
      }),
    );

    expect(result.current.draft).toEqual(draft);
    expect(result.current.hasStaleAlert).toBe(true);
  });

  it("ignores corrupted JSON in storage", () => {
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    localStorage.setItem(key, "not-json");
    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );
    expect(result.current.draft).toBeNull();
  });

  it("ignores structurally invalid draft shapes", () => {
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    localStorage.setItem(
      key,
      JSON.stringify({ body: 42, frontmatter: {}, savedAt: 1 }),
    );
    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );
    expect(result.current.draft).toBeNull();
  });

  it("clearDraft removes from storage, cancels pending writes, and resets state", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );

    act(() => {
      result.current.setDraft({ body: "hi", frontmatter: {} });
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.clearDraft();
    });
    expect(result.current.draft).toBeNull();
    expect(result.current.isDirty).toBe(false);

    // Pending 500ms write should be cancelled — advancing timers must not
    // re-persist the now-cleared draft.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("dismissStaleAlert lowers the flag without touching the draft", () => {
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    localStorage.setItem(
      key,
      JSON.stringify({
        body: "local",
        frontmatter: {},
        savedAt: SERVER_EPOCH + 1,
      }),
    );

    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );
    expect(result.current.hasStaleAlert).toBe(true);
    act(() => {
      result.current.dismissStaleAlert();
    });
    expect(result.current.hasStaleAlert).toBe(false);
    expect(result.current.draft).not.toBeNull();
  });

  it("clears the pending debounce on unmount to avoid ghost writes", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );

    act(() => {
      result.current.setDraft({ body: "x", frontmatter: {} });
    });
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Unmount cancels the pending write.
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("swallows setItem failures without throwing", () => {
    vi.useFakeTimers();
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );

    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    act(() => {
      result.current.setDraft({ body: "x", frontmatter: {} });
    });
    // The debounce fires — writeDraft internally swallows the error.
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }).not.toThrow();

    spy.mockRestore();
    // Nothing was persisted (setItem threw).
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("swallows removeItem failures during clearDraft", () => {
    const { result } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", snapshot),
    );
    const spy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    expect(() => {
      act(() => result.current.clearDraft());
    }).not.toThrow();

    spy.mockRestore();
  });

  it("is stable across re-renders that pass a fresh snapshot object with the same lastCommitTime", () => {
    const key = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "index.md");
    const stored = {
      body: "local",
      frontmatter: {},
      savedAt: SERVER_EPOCH + 10,
    };
    localStorage.setItem(key, JSON.stringify(stored));

    // Each render creates a NEW snapshot object reference. If the hook
    // depended on object identity this would loop forever and OOM the
    // test worker — so the test guards against that regression.
    const { result, rerender } = renderHook(() =>
      useWikiDraft("wiki-1", "index.md", {
        body: "server",
        frontmatter: {},
        lastCommitTime: snapshot.lastCommitTime,
      }),
    );
    expect(result.current.draft?.body).toBe("local");
    rerender();
    rerender();
    expect(result.current.draft?.body).toBe("local");
  });

  it("reloads the draft when the key changes (e.g. navigating between pages)", () => {
    const key1 = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "a.md");
    const key2 = buildDraftKey(USER.id, WORKSPACE, "wiki-1", "b.md");
    localStorage.setItem(
      key1,
      JSON.stringify({
        body: "a",
        frontmatter: {},
        savedAt: SERVER_EPOCH + 1,
      }),
    );
    localStorage.setItem(
      key2,
      JSON.stringify({
        body: "b",
        frontmatter: {},
        savedAt: SERVER_EPOCH + 2,
      }),
    );

    const { result, rerender } = renderHook(
      ({ p }: { p: string }) => useWikiDraft("wiki-1", p, snapshot),
      { initialProps: { p: "a.md" } },
    );
    expect(result.current.draft?.body).toBe("a");
    rerender({ p: "b.md" });
    expect(result.current.draft?.body).toBe("b");
  });
});
