import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildFolderDraftKey,
  useFolderDraft,
  type FolderDraftServerSnapshot,
} from "../useFolderDraft";

const DRAFT_KEY = "ws-1.routine-1.user-1";

const snapshot: FolderDraftServerSnapshot = {
  body: "server body",
  frontmatter: { title: "Server" },
  lastCommitTime: "2026-04-10T00:00:00.000Z",
};

const SERVER_EPOCH = new Date(snapshot.lastCommitTime!).getTime();

describe("buildFolderDraftKey", () => {
  it("namespace is fully caller-controlled", () => {
    // The caller decides the entire identifier between
    // `team9.folder.draft.` and the path segment — the hook does NOT
    // pull a workspace / user identifier from anywhere internally.
    const key = buildFolderDraftKey("anything-the-caller-wants", "a.md");
    expect(
      key.startsWith("team9.folder.draft.anything-the-caller-wants."),
    ).toBe(true);
  });

  it("includes the caller-provided draftKey and base64(path)", () => {
    const key = buildFolderDraftKey(DRAFT_KEY, "docs/index.md");
    const pathB64 = btoa(
      String.fromCharCode(...new TextEncoder().encode("docs/index.md")),
    );
    expect(key).toBe(`team9.folder.draft.${DRAFT_KEY}.${pathB64}`);
  });

  it("produces different keys per draftKey or path", () => {
    const base = buildFolderDraftKey(DRAFT_KEY, "a.md");
    expect(buildFolderDraftKey("ws-1.routine-2.user-1", "a.md")).not.toBe(base);
    expect(buildFolderDraftKey(DRAFT_KEY, "b.md")).not.toBe(base);
  });

  it("survives unicode / non-ascii paths", () => {
    // Must not throw — btoa of raw unicode would.
    expect(() =>
      buildFolderDraftKey(DRAFT_KEY, "docs/中文/ページ.md"),
    ).not.toThrow();
  });
});

describe("useFolderDraft", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    if (vi.isFakeTimers()) vi.useRealTimers();
    localStorage.clear();
  });

  it("returns a disabled hook (null draft) when draftKey is null", () => {
    const { result } = renderHook(() =>
      useFolderDraft(null, "index.md", snapshot),
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

  it("no-ops when draftKey or path is null", () => {
    const { result, rerender } = renderHook(
      ({ k, p }: { k: string | null; p: string | null }) =>
        useFolderDraft(k, p, snapshot),
      {
        initialProps: { k: null, p: null } as {
          k: string | null;
          p: string | null;
        },
      },
    );
    expect(result.current.draft).toBeNull();
    rerender({ k: DRAFT_KEY, p: null });
    expect(result.current.draft).toBeNull();
    rerender({ k: null, p: "a.md" });
    expect(result.current.draft).toBeNull();
  });

  it("no-ops when serverSnapshot is null (still loading)", () => {
    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", null),
    );
    expect(result.current.draft).toBeNull();
    expect(result.current.hasStaleAlert).toBe(false);
  });

  it("writes draft to localStorage after 500ms debounce", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
    );

    act(() => {
      result.current.setDraft({ body: "hi", frontmatter: { a: 1 } });
    });

    // In-memory draft is immediately dirty.
    expect(result.current.isDirty).toBe(true);
    expect(result.current.draft?.body).toBe("hi");

    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
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
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
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
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
    // Still not persisted — timer was reset by second call.
    expect(localStorage.getItem(key)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const parsed = JSON.parse(localStorage.getItem(key)!);
    expect(parsed.body).toBe("two");
  });

  it("loads an existing draft on mount and raises stale-alert when newer than server", () => {
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
    const newerDraft = {
      body: "local edits",
      frontmatter: { x: true },
      savedAt: SERVER_EPOCH + 10_000,
    };
    localStorage.setItem(key, JSON.stringify(newerDraft));

    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
    );

    expect(result.current.draft).toEqual(newerDraft);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.hasStaleAlert).toBe(true);
  });

  it("silently discards a draft older than the latest commit", () => {
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
    const olderDraft = {
      body: "old",
      frontmatter: {},
      savedAt: SERVER_EPOCH - 60_000,
    };
    localStorage.setItem(key, JSON.stringify(olderDraft));

    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
    );

    expect(result.current.draft).toBeNull();
    expect(result.current.hasStaleAlert).toBe(false);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("treats lastCommitTime=null as epoch 0 (any draft wins, stale-alert raised)", () => {
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
    const draft = { body: "d", frontmatter: {}, savedAt: 100 };
    localStorage.setItem(key, JSON.stringify(draft));

    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", {
        body: "",
        frontmatter: {},
        lastCommitTime: null,
      }),
    );

    expect(result.current.draft).toEqual(draft);
    expect(result.current.hasStaleAlert).toBe(true);
  });

  it("ignores corrupted JSON in storage", () => {
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
    localStorage.setItem(key, "not-json");
    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
    );
    expect(result.current.draft).toBeNull();
  });

  it("ignores structurally invalid draft shapes", () => {
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
    localStorage.setItem(
      key,
      JSON.stringify({ body: 42, frontmatter: {}, savedAt: 1 }),
    );
    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
    );
    expect(result.current.draft).toBeNull();
  });

  it("clearDraft removes from storage, cancels pending writes, and resets state", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
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
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("dismissStaleAlert lowers the flag without touching the draft", () => {
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
    localStorage.setItem(
      key,
      JSON.stringify({
        body: "local",
        frontmatter: {},
        savedAt: SERVER_EPOCH + 1,
      }),
    );

    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
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
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
    );

    act(() => {
      result.current.setDraft({ body: "x", frontmatter: {} });
    });
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Unmount cancels the pending write.
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("swallows setItem failures without throwing", () => {
    vi.useFakeTimers();
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
    );

    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    act(() => {
      result.current.setDraft({ body: "x", frontmatter: {} });
    });
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }).not.toThrow();

    spy.mockRestore();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("swallows removeItem failures during clearDraft", () => {
    const { result } = renderHook(() =>
      useFolderDraft(DRAFT_KEY, "index.md", snapshot),
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
    const key = buildFolderDraftKey(DRAFT_KEY, "index.md");
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
      useFolderDraft(DRAFT_KEY, "index.md", {
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

  it("reloads the draft when the key changes (e.g. navigating between paths)", () => {
    const key1 = buildFolderDraftKey(DRAFT_KEY, "a.md");
    const key2 = buildFolderDraftKey(DRAFT_KEY, "b.md");
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
      ({ p }: { p: string }) => useFolderDraft(DRAFT_KEY, p, snapshot),
      { initialProps: { p: "a.md" } },
    );
    expect(result.current.draft?.body).toBe("a");
    rerender({ p: "b.md" });
    expect(result.current.draft?.body).toBe("b");
  });

  it("reloads when draftKey changes (e.g. switching folders)", () => {
    const keyA = buildFolderDraftKey("ws-1.folder-A.user-1", "index.md");
    const keyB = buildFolderDraftKey("ws-1.folder-B.user-1", "index.md");
    localStorage.setItem(
      keyA,
      JSON.stringify({
        body: "a",
        frontmatter: {},
        savedAt: SERVER_EPOCH + 1,
      }),
    );
    localStorage.setItem(
      keyB,
      JSON.stringify({
        body: "b",
        frontmatter: {},
        savedAt: SERVER_EPOCH + 2,
      }),
    );

    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => useFolderDraft(k, "index.md", snapshot),
      { initialProps: { k: "ws-1.folder-A.user-1" } },
    );
    expect(result.current.draft?.body).toBe("a");
    rerender({ k: "ws-1.folder-B.user-1" });
    expect(result.current.draft?.body).toBe("b");
  });
});
