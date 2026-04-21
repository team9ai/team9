import { render, waitFor } from "@testing-library/react";
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

import { Route as WikiSplatRoute } from "../$wikiSlug.$";
import { useWikiStore } from "@/stores/useWikiStore";

function renderRouteComponent(route: unknown) {
  const Component = (route as { __config: { component: () => JSX.Element } })
    .__config.component;
  return render(<Component />);
}

describe("/_authenticated/wiki/$wikiSlug/$ route component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWikiStore.getState().reset();
  });

  afterEach(() => {
    useWikiStore.getState().reset();
  });

  it("sets the store and expands every ancestor directory for a deep path", async () => {
    mockUseParams.mockReturnValue({
      wikiSlug: "public",
      _splat: "api/docs/auth.md",
    });
    mockUseWikis.mockReturnValue({
      data: [{ id: "wiki-public", slug: "public" }],
    });

    renderRouteComponent(WikiSplatRoute);

    await waitFor(() => {
      const state = useWikiStore.getState();
      expect(state.selectedWikiId).toBe("wiki-public");
      expect(state.selectedPagePath).toBe("api/docs/auth.md");
      expect(state.expandedDirectories.has("api")).toBe(true);
      expect(state.expandedDirectories.has("api/docs")).toBe(true);
    });
  });

  it("does not expand anything for a top-level file path", async () => {
    mockUseParams.mockReturnValue({
      wikiSlug: "public",
      _splat: "README.md",
    });
    mockUseWikis.mockReturnValue({
      data: [{ id: "wiki-public", slug: "public" }],
    });

    renderRouteComponent(WikiSplatRoute);

    await waitFor(() => {
      expect(useWikiStore.getState().selectedPagePath).toBe("README.md");
    });
    expect(useWikiStore.getState().expandedDirectories.size).toBe(0);
  });

  it("auto-expand is idempotent — pre-expanded dirs stay expanded", async () => {
    // Simulate a user who already expanded `api` via a sidebar click.
    useWikiStore.getState().toggleDirectory("api");
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);

    mockUseParams.mockReturnValue({
      wikiSlug: "public",
      _splat: "api/docs/auth.md",
    });
    mockUseWikis.mockReturnValue({
      data: [{ id: "wiki-public", slug: "public" }],
    });

    renderRouteComponent(WikiSplatRoute);

    await waitFor(() => {
      expect(useWikiStore.getState().expandedDirectories.has("api/docs")).toBe(
        true,
      );
    });

    // Critical: the navigation-time expand must NOT have flipped `api` closed.
    expect(useWikiStore.getState().expandedDirectories.has("api")).toBe(true);
  });

  it("is a no-op when the slug doesn't match any wiki", async () => {
    mockUseParams.mockReturnValue({
      wikiSlug: "missing",
      _splat: "api/auth.md",
    });
    mockUseWikis.mockReturnValue({
      data: [{ id: "wiki-public", slug: "public" }],
    });

    renderRouteComponent(WikiSplatRoute);
    await Promise.resolve();

    expect(useWikiStore.getState().selectedWikiId).toBeNull();
    expect(useWikiStore.getState().expandedDirectories.size).toBe(0);
  });

  it("is a no-op when `_splat` is empty", async () => {
    mockUseParams.mockReturnValue({
      wikiSlug: "public",
      _splat: "",
    });
    mockUseWikis.mockReturnValue({
      data: [{ id: "wiki-public", slug: "public" }],
    });

    renderRouteComponent(WikiSplatRoute);
    await Promise.resolve();

    expect(useWikiStore.getState().selectedWikiId).toBeNull();
    expect(useWikiStore.getState().selectedPagePath).toBeNull();
  });

  it("waits for `useWikis` data — undefined doesn't crash", async () => {
    mockUseParams.mockReturnValue({
      wikiSlug: "public",
      _splat: "api/auth.md",
    });
    mockUseWikis.mockReturnValue({ data: undefined });

    renderRouteComponent(WikiSplatRoute);
    await Promise.resolve();

    expect(useWikiStore.getState().selectedWikiId).toBeNull();
  });

  it("renders WikiMainContent as the body", () => {
    mockUseParams.mockReturnValue({
      wikiSlug: "public",
      _splat: "README.md",
    });
    mockUseWikis.mockReturnValue({ data: [] });

    const { getByTestId } = renderRouteComponent(WikiSplatRoute);
    expect(getByTestId("wiki-main-content")).toBeInTheDocument();
  });
});
