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

vi.mock("@/components/wiki/ReviewPanel", () => ({
  ReviewPanel: ({ wiki }: { wiki: { id: string; slug: string } }) => (
    <div
      data-testid="review-panel-mock"
      data-wiki-id={wiki.id}
      data-wiki-slug={wiki.slug}
    />
  ),
}));

import { Route as WikiReviewRoute } from "../$wikiSlug.dash-review";
import { useWikiStore } from "@/stores/useWikiStore";

function renderRouteComponent(route: unknown) {
  const Component = (route as { __config: { component: () => JSX.Element } })
    .__config.component;
  return render(<Component />);
}

describe("/_authenticated/wiki/$wikiSlug/-/review route component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWikiStore.getState().reset();
  });

  afterEach(() => {
    useWikiStore.getState().reset();
  });

  it("looks up the wiki by slug and seeds selectedWikiId", async () => {
    mockUseParams.mockReturnValue({ wikiSlug: "public" });
    mockUseWikis.mockReturnValue({
      data: [
        { id: "wiki-public", slug: "public" },
        { id: "wiki-private", slug: "private" },
      ],
    });

    const { getByTestId } = renderRouteComponent(WikiReviewRoute);

    await waitFor(() => {
      expect(useWikiStore.getState().selectedWikiId).toBe("wiki-public");
    });
    expect(getByTestId("review-panel-mock")).toHaveAttribute(
      "data-wiki-id",
      "wiki-public",
    );
  });

  it("renders the not-found fallback when the slug has no matching wiki", async () => {
    mockUseParams.mockReturnValue({ wikiSlug: "missing" });
    mockUseWikis.mockReturnValue({
      data: [{ id: "wiki-public", slug: "public" }],
    });

    const { queryByTestId, getByTestId } =
      renderRouteComponent(WikiReviewRoute);

    await Promise.resolve();
    expect(queryByTestId("review-panel-mock")).toBeNull();
    expect(getByTestId("wiki-review-route-missing")).toBeInTheDocument();
    expect(useWikiStore.getState().selectedWikiId).toBeNull();
  });

  it("waits for `useWikis` data — undefined renders the fallback gracefully", () => {
    mockUseParams.mockReturnValue({ wikiSlug: "public" });
    mockUseWikis.mockReturnValue({ data: undefined });

    const { queryByTestId, getByTestId } =
      renderRouteComponent(WikiReviewRoute);

    expect(queryByTestId("review-panel-mock")).toBeNull();
    expect(getByTestId("wiki-review-route-missing")).toBeInTheDocument();
  });

  it("route file exports a Route object (smoke test)", () => {
    // The Route export exists and has the expected shape produced by
    // createFileRoute() in the mock (an object with useParams and __config).
    expect(WikiReviewRoute).toBeDefined();
    expect(
      (WikiReviewRoute as unknown as { __config: unknown }).__config,
    ).toBeDefined();
  });
});
