import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// Replace the wsService singleton so mounting `useWikiWebSocketSync` from
// inside `WikiMainContent` does not attach listeners to the real socket.
// `vi.hoisted` keeps the spies available inside the hoisted `vi.mock`
// factory without running afoul of the module-load-order rules.
const wsSpies = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
}));
vi.mock("@/services/websocket", () => ({
  default: {
    on: wsSpies.on,
    off: wsSpies.off,
  },
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("WikiMainContent", () => {
  beforeEach(() => {
    // Clear here (not in afterEach) so RTL's own auto-unmount — which runs
    // as an afterEach and therefore **after** ours — doesn't inflate the
    // `off` call count observed by the next test.
    wsSpies.on.mockClear();
    wsSpies.off.mockClear();
  });

  afterEach(() => {
    act(() => {
      useWikiStore.getState().reset();
    });
  });

  it("shows the empty state when no wiki is selected", () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <WikiMainContent />
      </Wrapper>,
    );

    expect(
      screen.getByRole("heading", { name: "Select a Wiki page" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-page-view-stub")).not.toBeInTheDocument();
    // The sync hook should have subscribed to every `wiki_*` event.
    expect(wsSpies.on).toHaveBeenCalled();
  });

  it("shows the empty state when a wiki is selected but no page path is set", () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <WikiMainContent />
      </Wrapper>,
    );

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
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <WikiMainContent />
      </Wrapper>,
    );

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

  it("unsubscribes wiki_* WebSocket handlers on unmount", () => {
    const Wrapper = makeWrapper();
    const { unmount } = render(
      <Wrapper>
        <WikiMainContent />
      </Wrapper>,
    );

    const subscribedCount = wsSpies.on.mock.calls.length;
    expect(subscribedCount).toBeGreaterThan(0);

    unmount();

    expect(wsSpies.off).toHaveBeenCalledTimes(subscribedCount);
  });
});
