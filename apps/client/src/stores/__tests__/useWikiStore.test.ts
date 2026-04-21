import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  useExpandedDirectories,
  useSelectedPagePath,
  useSelectedWikiId,
  useWikiStore,
  wikiActions,
} from "../useWikiStore";

describe("useWikiStore", () => {
  beforeEach(() => {
    useWikiStore.getState().reset();
  });

  it("starts with documented initial state", () => {
    const state = useWikiStore.getState();
    expect(state.selectedWikiId).toBeNull();
    expect(state.selectedPagePath).toBeNull();
    expect(state.expandedDirectories).toEqual(new Set());
  });

  it("setSelectedWiki updates the id", () => {
    useWikiStore.getState().setSelectedWiki("wiki-1");
    expect(useWikiStore.getState().selectedWikiId).toBe("wiki-1");
  });

  it("setSelectedWiki clears the selected page path", () => {
    useWikiStore.getState().setSelectedPage("/intro.md");
    useWikiStore.getState().setSelectedWiki("wiki-2");
    expect(useWikiStore.getState().selectedPagePath).toBeNull();
  });

  it("setSelectedPage updates the path", () => {
    useWikiStore.getState().setSelectedPage("/intro.md");
    expect(useWikiStore.getState().selectedPagePath).toBe("/intro.md");
  });

  it("setSelectedPage can clear the path", () => {
    useWikiStore.getState().setSelectedPage("/intro.md");
    useWikiStore.getState().setSelectedPage(null);
    expect(useWikiStore.getState().selectedPagePath).toBeNull();
  });

  it("toggleDirectory adds an unexpanded key", () => {
    useWikiStore.getState().toggleDirectory("/docs");
    expect(useWikiStore.getState().expandedDirectories.has("/docs")).toBe(true);
  });

  it("toggleDirectory removes an already-expanded key (de-dup)", () => {
    useWikiStore.getState().toggleDirectory("/docs");
    useWikiStore.getState().toggleDirectory("/docs");
    expect(useWikiStore.getState().expandedDirectories.has("/docs")).toBe(
      false,
    );
  });

  it("toggleDirectory returns a new Set each call (immutable)", () => {
    const before = useWikiStore.getState().expandedDirectories;
    useWikiStore.getState().toggleDirectory("/docs");
    const after = useWikiStore.getState().expandedDirectories;
    expect(after).not.toBe(before);
  });

  it("reset returns state to initial", () => {
    useWikiStore.getState().setSelectedWiki("wiki-1");
    useWikiStore.getState().setSelectedPage("/intro.md");
    useWikiStore.getState().toggleDirectory("/docs");
    useWikiStore.getState().reset();

    const state = useWikiStore.getState();
    expect(state.selectedWikiId).toBeNull();
    expect(state.selectedPagePath).toBeNull();
    expect(state.expandedDirectories).toEqual(new Set());
  });

  it("selector hooks subscribe to the right slices", () => {
    const { result: wikiIdResult } = renderHook(() => useSelectedWikiId());
    const { result: pagePathResult } = renderHook(() => useSelectedPagePath());
    const { result: dirsResult } = renderHook(() => useExpandedDirectories());

    expect(wikiIdResult.current).toBeNull();
    expect(pagePathResult.current).toBeNull();
    expect(dirsResult.current).toEqual(new Set());

    act(() => {
      useWikiStore.getState().setSelectedWiki("wiki-1");
      useWikiStore.getState().setSelectedPage("/intro.md");
      useWikiStore.getState().toggleDirectory("/docs");
    });

    // setSelectedWiki wipes the page path; set it again after the wiki switch.
    act(() => {
      useWikiStore.getState().setSelectedPage("/intro.md");
    });

    expect(wikiIdResult.current).toBe("wiki-1");
    expect(pagePathResult.current).toBe("/intro.md");
    expect(dirsResult.current.has("/docs")).toBe(true);
  });

  it("wikiActions.setSelectedWiki proxies to the store", () => {
    wikiActions.setSelectedWiki("wiki-1");
    expect(useWikiStore.getState().selectedWikiId).toBe("wiki-1");
  });

  it("wikiActions.setSelectedWiki(null) clears both wiki and page", () => {
    useWikiStore.getState().setSelectedWiki("wiki-1");
    useWikiStore.getState().setSelectedPage("/intro.md");
    wikiActions.setSelectedWiki(null);
    expect(useWikiStore.getState().selectedWikiId).toBeNull();
    expect(useWikiStore.getState().selectedPagePath).toBeNull();
  });

  it("wikiActions.setSelectedPage proxies to the store", () => {
    wikiActions.setSelectedPage("/intro.md");
    expect(useWikiStore.getState().selectedPagePath).toBe("/intro.md");
  });

  it("wikiActions.toggleDirectory proxies to the store", () => {
    wikiActions.toggleDirectory("/docs");
    expect(useWikiStore.getState().expandedDirectories.has("/docs")).toBe(true);
    wikiActions.toggleDirectory("/docs");
    expect(useWikiStore.getState().expandedDirectories.has("/docs")).toBe(
      false,
    );
  });

  it("wikiActions.reset proxies to the store", () => {
    useWikiStore.getState().setSelectedWiki("wiki-1");
    wikiActions.reset();
    expect(useWikiStore.getState().selectedWikiId).toBeNull();
  });
});
