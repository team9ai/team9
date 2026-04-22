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

vi.mock("@/components/wiki/ProposalDiffView", () => ({
  ProposalDiffView: (props: {
    wiki: { id: string; slug: string };
    proposalId: string;
  }) => (
    <div
      data-testid="proposal-diff-view-mock"
      data-wiki-id={props.wiki.id}
      data-proposal-id={props.proposalId}
    />
  ),
}));

import { Route as WikiReviewDetailRoute } from "../$wikiSlug.dash-review.$proposalId";
import { useWikiStore } from "@/stores/useWikiStore";

function renderRouteComponent(route: unknown) {
  const Component = (route as { __config: { component: () => JSX.Element } })
    .__config.component;
  return render(<Component />);
}

describe("/_authenticated/wiki/$wikiSlug/-/review/$proposalId route component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWikiStore.getState().reset();
  });

  afterEach(() => {
    useWikiStore.getState().reset();
  });

  it("resolves the wiki and forwards the proposal id to the detail view", async () => {
    mockUseParams.mockReturnValue({
      wikiSlug: "public",
      proposalId: "prop-1",
    });
    mockUseWikis.mockReturnValue({
      data: [{ id: "wiki-public", slug: "public" }],
    });

    const { getByTestId } = renderRouteComponent(WikiReviewDetailRoute);

    await waitFor(() => {
      expect(useWikiStore.getState().selectedWikiId).toBe("wiki-public");
    });

    const view = getByTestId("proposal-diff-view-mock");
    expect(view).toHaveAttribute("data-wiki-id", "wiki-public");
    expect(view).toHaveAttribute("data-proposal-id", "prop-1");
  });

  it("renders the not-found fallback when the slug doesn't match", async () => {
    mockUseParams.mockReturnValue({
      wikiSlug: "missing",
      proposalId: "prop-1",
    });
    mockUseWikis.mockReturnValue({
      data: [{ id: "wiki-public", slug: "public" }],
    });

    const { queryByTestId, getByTestId } = renderRouteComponent(
      WikiReviewDetailRoute,
    );

    await Promise.resolve();
    expect(queryByTestId("proposal-diff-view-mock")).toBeNull();
    expect(getByTestId("wiki-review-detail-route-missing")).toBeInTheDocument();
    expect(useWikiStore.getState().selectedWikiId).toBeNull();
  });

  it("waits for `useWikis` data — undefined renders the fallback gracefully", () => {
    mockUseParams.mockReturnValue({
      wikiSlug: "public",
      proposalId: "prop-1",
    });
    mockUseWikis.mockReturnValue({ data: undefined });

    const { queryByTestId, getByTestId } = renderRouteComponent(
      WikiReviewDetailRoute,
    );

    expect(queryByTestId("proposal-diff-view-mock")).toBeNull();
    expect(getByTestId("wiki-review-detail-route-missing")).toBeInTheDocument();
  });

  it("route file exports a Route object (smoke test)", () => {
    // The Route export exists and has the expected shape produced by
    // createFileRoute() in the mock (an object with useParams and __config).
    expect(WikiReviewDetailRoute).toBeDefined();
    expect(
      (WikiReviewDetailRoute as unknown as { __config: unknown }).__config,
    ).toBeDefined();
  });
});
