import { render, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseParams = vi.hoisted(() => vi.fn());
const mockUseWikis = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({
    useParams: mockUseParams,
    __config: config,
  }),
}));

vi.mock("@/hooks/useWikis", () => ({
  useWikis: mockUseWikis,
}));

vi.mock("@/components/layout/contents/WikiMainContent", () => ({
  WikiMainContent: () => <div data-testid="wiki-main-content" />,
}));

import { Route as WikiSlugRoute } from "../$wikiSlug";
import { useWikiStore } from "@/stores/useWikiStore";

function renderRouteComponent(route: unknown) {
  const Component = (route as { __config: { component: () => JSX.Element } })
    .__config.component;
  return render(<Component />);
}

describe("/_authenticated/wiki/$wikiSlug route component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWikiStore.getState().reset();
  });

  afterEach(() => {
    useWikiStore.getState().reset();
  });

  it("looks up the wiki by slug and seeds selectedWikiId + index.md9", async () => {
    mockUseParams.mockReturnValue({ wikiSlug: "public" });
    mockUseWikis.mockReturnValue({
      data: [
        { id: "wiki-public", slug: "public" },
        { id: "wiki-private", slug: "private" },
      ],
    });

    renderRouteComponent(WikiSlugRoute);

    await waitFor(() => {
      expect(useWikiStore.getState().selectedWikiId).toBe("wiki-public");
      expect(useWikiStore.getState().selectedPagePath).toBe("index.md9");
    });
  });

  it("is a no-op when the slug has no matching wiki", async () => {
    mockUseParams.mockReturnValue({ wikiSlug: "missing" });
    mockUseWikis.mockReturnValue({
      data: [{ id: "wiki-public", slug: "public" }],
    });

    renderRouteComponent(WikiSlugRoute);

    // Give the effect a tick to run.
    await Promise.resolve();
    expect(useWikiStore.getState().selectedWikiId).toBeNull();
    expect(useWikiStore.getState().selectedPagePath).toBeNull();
  });

  it("waits for `useWikis` data — undefined doesn't crash", async () => {
    mockUseParams.mockReturnValue({ wikiSlug: "public" });
    mockUseWikis.mockReturnValue({ data: undefined });

    renderRouteComponent(WikiSlugRoute);
    await Promise.resolve();

    expect(useWikiStore.getState().selectedWikiId).toBeNull();
  });

  it("renders `WikiMainContent` as the body", () => {
    mockUseParams.mockReturnValue({ wikiSlug: "public" });
    mockUseWikis.mockReturnValue({ data: [] });

    const { getByTestId } = renderRouteComponent(WikiSlugRoute);
    expect(getByTestId("wiki-main-content")).toBeInTheDocument();
  });
});
