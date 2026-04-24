import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  submittedProposalKey,
  useExpandedDirectories,
  useSelectedPagePath,
  useSelectedWikiId,
  useSubmittedProposal,
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
    expect(state.submittedProposals).toEqual({});
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

  it("expandDirectory adds a new key", () => {
    useWikiStore.getState().expandDirectory("api");
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);
  });

  it("expandDirectory is idempotent — calling twice keeps the key expanded", () => {
    useWikiStore.getState().expandDirectory("api");
    useWikiStore.getState().expandDirectory("api");
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);
    expect(useWikiStore.getState().expandedDirectories.size).toBe(1);
  });

  it("expandDirectory never collapses an already-expanded directory", () => {
    useWikiStore.getState().toggleDirectory("api");
    // A second `expandDirectory` must NOT flip it closed (unlike toggleDirectory).
    useWikiStore.getState().expandDirectory("api");
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);
  });

  it("expandDirectory supports multiple distinct keys", () => {
    useWikiStore.getState().expandDirectory("api");
    useWikiStore.getState().expandDirectory("api/docs");
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);
    expect(useWikiStore.getState().expandedDirectories.has("api/docs")).toBe(
      true,
    );
    expect(useWikiStore.getState().expandedDirectories.size).toBe(2);
  });

  it("expandDirectory is a no-op reference-wise when the key already exists", () => {
    useWikiStore.getState().expandDirectory("api");
    const before = useWikiStore.getState().expandedDirectories;
    useWikiStore.getState().expandDirectory("api");
    const after = useWikiStore.getState().expandedDirectories;
    // Idempotent adds should not allocate a new Set — subscribers stay quiet.
    expect(after).toBe(before);
  });

  it("reset returns state to initial", () => {
    useWikiStore.getState().setSelectedWiki("wiki-1");
    useWikiStore.getState().setSelectedPage("/intro.md");
    useWikiStore.getState().toggleDirectory("/docs");
    useWikiStore
      .getState()
      .setSubmittedProposal("wiki-1", "index.md", "prop-1");
    useWikiStore.getState().reset();

    const state = useWikiStore.getState();
    expect(state.selectedWikiId).toBeNull();
    expect(state.selectedPagePath).toBeNull();
    expect(state.expandedDirectories).toEqual(new Set());
    expect(state.submittedProposals).toEqual({});
  });

  describe("submittedProposals", () => {
    it("submittedProposalKey composes a deterministic key", () => {
      expect(submittedProposalKey("wiki-1", "docs/intro.md")).toBe(
        "wiki-1:docs/intro.md",
      );
    });

    it("setSubmittedProposal records a proposal id under the composite key", () => {
      useWikiStore
        .getState()
        .setSubmittedProposal("wiki-1", "index.md", "prop-1");
      expect(
        useWikiStore.getState().submittedProposals["wiki-1:index.md"],
      ).toBe("prop-1");
    });

    it("setSubmittedProposal replaces an existing proposal id for the same page", () => {
      useWikiStore
        .getState()
        .setSubmittedProposal("wiki-1", "index.md", "prop-1");
      useWikiStore
        .getState()
        .setSubmittedProposal("wiki-1", "index.md", "prop-2");
      expect(
        useWikiStore.getState().submittedProposals["wiki-1:index.md"],
      ).toBe("prop-2");
    });

    it("setSubmittedProposal is a reference no-op when the same id is set twice", () => {
      useWikiStore
        .getState()
        .setSubmittedProposal("wiki-1", "index.md", "prop-1");
      const before = useWikiStore.getState().submittedProposals;
      useWikiStore
        .getState()
        .setSubmittedProposal("wiki-1", "index.md", "prop-1");
      const after = useWikiStore.getState().submittedProposals;
      expect(after).toBe(before);
    });

    it("setSubmittedProposal with null removes the entry", () => {
      useWikiStore
        .getState()
        .setSubmittedProposal("wiki-1", "index.md", "prop-1");
      useWikiStore.getState().setSubmittedProposal("wiki-1", "index.md", null);
      expect(
        "wiki-1:index.md" in useWikiStore.getState().submittedProposals,
      ).toBe(false);
    });

    it("setSubmittedProposal(null) on a missing key is a reference no-op", () => {
      const before = useWikiStore.getState().submittedProposals;
      useWikiStore.getState().setSubmittedProposal("wiki-1", "index.md", null);
      const after = useWikiStore.getState().submittedProposals;
      expect(after).toBe(before);
    });

    it("setSubmittedProposal isolates entries across wikis and paths", () => {
      useWikiStore
        .getState()
        .setSubmittedProposal("wiki-1", "index.md", "prop-a");
      useWikiStore
        .getState()
        .setSubmittedProposal("wiki-2", "index.md", "prop-b");
      useWikiStore
        .getState()
        .setSubmittedProposal("wiki-1", "docs/other.md", "prop-c");
      expect(useWikiStore.getState().submittedProposals).toEqual({
        "wiki-1:index.md": "prop-a",
        "wiki-2:index.md": "prop-b",
        "wiki-1:docs/other.md": "prop-c",
      });
    });

    it("useSubmittedProposal selector returns the proposal id for a given page", () => {
      const { result } = renderHook(() =>
        useSubmittedProposal("wiki-1", "index.md"),
      );
      expect(result.current).toBeNull();

      act(() => {
        useWikiStore
          .getState()
          .setSubmittedProposal("wiki-1", "index.md", "prop-1");
      });
      expect(result.current).toBe("prop-1");

      act(() => {
        useWikiStore
          .getState()
          .setSubmittedProposal("wiki-1", "index.md", null);
      });
      expect(result.current).toBeNull();
    });

    it("useSubmittedProposal is scoped — an unrelated page's entry is invisible", () => {
      useWikiStore
        .getState()
        .setSubmittedProposal("wiki-1", "other.md", "prop-1");
      const { result } = renderHook(() =>
        useSubmittedProposal("wiki-1", "index.md"),
      );
      expect(result.current).toBeNull();
    });

    it("wikiActions.setSubmittedProposal proxies to the store", () => {
      wikiActions.setSubmittedProposal("wiki-1", "index.md", "prop-1");
      expect(
        useWikiStore.getState().submittedProposals["wiki-1:index.md"],
      ).toBe("prop-1");
      wikiActions.setSubmittedProposal("wiki-1", "index.md", null);
      expect(
        "wiki-1:index.md" in useWikiStore.getState().submittedProposals,
      ).toBe(false);
    });
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

  it("wikiActions.expandDirectory proxies to the store (idempotent)", () => {
    wikiActions.expandDirectory("api");
    wikiActions.expandDirectory("api");
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);
    expect(useWikiStore.getState().expandedDirectories.size).toBe(1);
  });

  it("wikiActions.reset proxies to the store", () => {
    useWikiStore.getState().setSelectedWiki("wiki-1");
    wikiActions.reset();
    expect(useWikiStore.getState().selectedWikiId).toBeNull();
  });
});
