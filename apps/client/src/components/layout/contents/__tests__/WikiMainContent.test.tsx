import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWikiStore } from "@/stores/useWikiStore";
import { WikiMainContent } from "../WikiMainContent";

// Stub WikiPageView so WikiMainContent tests don't accidentally exercise
// its React Query dependencies. The view's own tests cover its internals.
vi.mock("@/components/wiki/WikiPageView", () => ({
  WikiPageView: ({ wikiId, path }: { wikiId: string; path: string }) => (
    <div
      data-testid="wiki-page-view-stub"
      data-wiki-id={wikiId}
      data-path={path}
    />
  ),
}));

describe("WikiMainContent", () => {
  afterEach(() => {
    act(() => {
      useWikiStore.getState().reset();
    });
  });

  it("shows the empty state when no wiki is selected", () => {
    render(<WikiMainContent />);

    expect(
      screen.getByRole("heading", { name: "Select a Wiki page" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-page-view-stub")).not.toBeInTheDocument();
  });

  it("shows the empty state when a wiki is selected but no page path is set", () => {
    render(<WikiMainContent />);

    // `setSelectedWiki` intentionally clears the previous page path, so this
    // recreates the moment right after selection but before a page click.
    act(() => {
      useWikiStore.getState().setSelectedWiki("wiki-1");
    });

    expect(
      screen.getByRole("heading", { name: "Select a Wiki page" }),
    ).toBeInTheDocument();
  });

  it("renders the page view once both wiki and page are set", () => {
    render(<WikiMainContent />);

    act(() => {
      useWikiStore.getState().setSelectedWiki("wiki-1");
      useWikiStore.getState().setSelectedPage("api/auth.md");
    });

    const stub = screen.getByTestId("wiki-page-view-stub");
    expect(stub.dataset.wikiId).toBe("wiki-1");
    expect(stub.dataset.path).toBe("api/auth.md");
    expect(
      screen.queryByRole("heading", { name: "Select a Wiki page" }),
    ).not.toBeInTheDocument();
  });
});
