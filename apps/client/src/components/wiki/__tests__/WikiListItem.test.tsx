import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiListItem } from "../WikiListItem";
import { useWikiStore } from "@/stores/useWikiStore";
import type { WikiDto, TreeEntryDto } from "@/types/wiki";

const mockUseWikiTree = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWikiTree", () => ({
  useWikiTree: (...args: unknown[]) => mockUseWikiTree(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const wiki: WikiDto = {
  id: "wiki-1",
  workspaceId: "ws-1",
  name: "Public Wiki",
  slug: "public",
  approvalMode: "auto",
  humanPermission: "write",
  agentPermission: "read",
  createdBy: "user-1",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
};

const treeEntries: TreeEntryDto[] = [
  { name: "index.md", path: "index.md", type: "file", size: 0 },
  { name: "auth.md", path: "api/auth.md", type: "file", size: 0 },
];

describe("WikiListItem", () => {
  beforeEach(() => {
    mockUseWikiTree.mockReset();
    mockNavigate.mockReset();
    act(() => {
      useWikiStore.getState().reset();
    });
  });

  afterEach(() => {
    act(() => {
      useWikiStore.getState().reset();
    });
  });

  it("does not fetch the tree while the row is collapsed", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);

    // Hook called with `null` so React Query stays disabled.
    expect(mockUseWikiTree).toHaveBeenCalledWith(null);
    // No tree rows rendered.
    expect(screen.queryByRole("button", { name: /index\.md/ })).toBeNull();
  });

  it("renders only the wiki row when collapsed", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);

    expect(
      screen.getByRole("button", { name: /Public Wiki/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /api/ })).toBeNull();
  });

  it("toggles via the wiki:<id> key in the shared store", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);

    fireEvent.click(screen.getByRole("button", { name: /Public Wiki/ }));

    expect(useWikiStore.getState().expandedDirectories.has("wiki:wiki-1")).toBe(
      true,
    );
  });

  it("fetches the tree and renders tree nodes once expanded", () => {
    // Pre-expand so the first render passes the wiki id into the hook.
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    mockUseWikiTree.mockReturnValue({ data: treeEntries });

    render(<WikiListItem wiki={wiki} />);

    expect(mockUseWikiTree).toHaveBeenCalledWith("wiki-1");
    // Tree rows now present; `api` (dir) and `index.md` (file at root).
    expect(screen.getByRole("button", { name: /^api$/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /index\.md/ }),
    ).toBeInTheDocument();
  });

  it("renders an empty tree without crashing while loading", () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    mockUseWikiTree.mockReturnValue({ data: undefined });

    render(<WikiListItem wiki={wiki} />);

    // Only the wiki row is present — no tree rows yet.
    expect(
      screen.getByRole("button", { name: /Public Wiki/ }),
    ).toBeInTheDocument();
  });

  it("renders a chevron-down when expanded, chevron-right when collapsed", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    const { container, rerender } = render(<WikiListItem wiki={wiki} />);
    expect(container.querySelector(".lucide-chevron-right")).not.toBeNull();

    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    rerender(<WikiListItem wiki={wiki} />);
    expect(container.querySelector(".lucide-chevron-down")).not.toBeNull();
  });
});
