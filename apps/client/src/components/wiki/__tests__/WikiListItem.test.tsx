import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiListItem } from "../WikiListItem";
import { useWikiStore } from "@/stores/useWikiStore";
import type { WikiDto, TreeEntryDto } from "@/types/wiki";

const mockUseWikiTree = vi.hoisted(() => vi.fn());
const mockUseWikiPage = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const mockCommit = vi.hoisted(() => vi.fn());
const archiveMutateAsync = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<void>>(),
);
const archivePending = vi.hoisted(() => ({ value: false }));

vi.mock("@/hooks/useWikiTree", () => ({
  useWikiTree: (...args: unknown[]) => mockUseWikiTree(...args),
}));

vi.mock("@/hooks/useWikiPage", () => ({
  useWikiPage: (...args: unknown[]) => mockUseWikiPage(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/services/api/wikis", () => ({
  wikisApi: {
    commit: (...args: unknown[]) => mockCommit(...args),
  },
}));

vi.mock("@/hooks/useWikis", () => ({
  useArchiveWiki: () => ({
    mutateAsync: archiveMutateAsync,
    get isPending() {
      return archivePending.value;
    },
  }),
  // The settings dialog pulls in useUpdateWiki — stubbed here even though
  // the list-item flow never touches the settings mutation directly.
  useUpdateWiki: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

// Settings dialog is covered by its own test file — mock it to a tiny
// shim so we only verify the list-item's open/close wiring.
vi.mock("../WikiSettingsDialog", () => ({
  WikiSettingsDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    wiki: WikiDto | null;
  }) =>
    props.open ? (
      <div data-testid="mock-settings-dialog" data-wiki-id={props.wiki?.id}>
        <button
          type="button"
          data-testid="mock-settings-close"
          onClick={() => props.onOpenChange(false)}
        >
          close
        </button>
      </div>
    ) : null,
}));

// Radix DropdownMenu relies on pointer events that jsdom doesn't fire from a
// plain `fireEvent.click`. Swap the UI wrapper for a minimal controlled
// menu so tests drive the exact prop surface the component cares about.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{
    open: boolean;
    setOpen: (open: boolean) => void;
  }>({
    open: false,
    setOpen: () => {},
  });

  const DropdownMenu = ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => {
    const [innerOpen, setInnerOpen] = React.useState(false);
    const controlled = open !== undefined;
    const actualOpen = controlled ? (open as boolean) : innerOpen;
    const setOpen = (next: boolean) => {
      if (!controlled) setInnerOpen(next);
      onOpenChange?.(next);
    };
    return (
      <Ctx.Provider value={{ open: actualOpen, setOpen }}>
        {children}
      </Ctx.Provider>
    );
  };

  const DropdownMenuTrigger = ({
    children,
  }: {
    asChild?: boolean;
    children: React.ReactNode;
  }) => {
    const { setOpen, open } = React.useContext(Ctx);
    // When `asChild`, the consumer passes a single ReactElement to wrap.
    if (React.isValidElement(children)) {
      const child = children as React.ReactElement<Record<string, unknown>>;
      return React.cloneElement(child, {
        onClick: (e: React.MouseEvent) => {
          (
            child.props.onClick as ((e: React.MouseEvent) => void) | undefined
          )?.(e);
          setOpen(!open);
        },
      });
    }
    return <>{children}</>;
  };

  const DropdownMenuContent = ({
    children,
  }: {
    align?: string;
    className?: string;
    children: React.ReactNode;
  }) => {
    const { open } = React.useContext(Ctx);
    return open ? <div role="menu">{children}</div> : null;
  };

  const DropdownMenuItem = ({
    children,
    onSelect,
    className,
    ...rest
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    className?: string;
  } & Record<string, unknown>) => {
    const { setOpen } = React.useContext(Ctx);
    return (
      <button
        type="button"
        role="menuitem"
        className={className}
        onClick={() => {
          onSelect?.();
          setOpen(false);
        }}
        {...rest}
      >
        {children}
      </button>
    );
  };

  const DropdownMenuSeparator = () => <hr role="separator" />;

  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
  };
});

const wiki: WikiDto = {
  id: "wiki-1",
  workspaceId: "ws-1",
  name: "Public Wiki",
  slug: "public",
  icon: null,
  approvalMode: "auto",
  humanPermission: "write",
  agentPermission: "read",
  createdBy: "user-1",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
};

const treeEntries: TreeEntryDto[] = [
  { name: "index.md9", path: "index.md9", type: "file", size: 0 },
  { name: "auth.md", path: "api/auth.md", type: "file", size: 0 },
];

describe("WikiListItem", () => {
  beforeEach(() => {
    mockUseWikiTree.mockReset();
    mockUseWikiPage.mockReset();
    mockUseWikiPage.mockReturnValue({ data: undefined });
    mockNavigate.mockReset();
    mockCommit.mockReset();
    mockCommit.mockResolvedValue({ commit: { sha: "sha-1" }, proposal: null });
    archiveMutateAsync.mockReset();
    archivePending.value = false;
    document.body.innerHTML = "";
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "prompt").mockImplementation(() => null);
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
    // No tree rows rendered. WikiTreeNode buttons carry role="treeitem" (A-3 fix).
    expect(screen.queryByRole("treeitem", { name: /^index$/ })).toBeNull();
  });

  it("outer div has role=treeitem, aria-level=1, and aria-expanded=false when collapsed", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    const { container } = render(<WikiListItem wiki={wiki} />);
    const treeitem = container.firstChild as HTMLElement;
    expect(treeitem).toHaveAttribute("role", "treeitem");
    expect(treeitem).toHaveAttribute("aria-level", "1");
    expect(treeitem).toHaveAttribute("aria-expanded", "false");
  });

  it("aria-expanded becomes true on the treeitem when expanded", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    const { container, rerender } = render(<WikiListItem wiki={wiki} />);
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    rerender(<WikiListItem wiki={wiki} />);
    const treeitem = container.firstChild as HTMLElement;
    expect(treeitem).toHaveAttribute("aria-expanded", "true");
  });

  it("children container has role=group when the row is expanded", () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    mockUseWikiTree.mockReturnValue({ data: treeEntries });
    render(<WikiListItem wiki={wiki} />);
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("renders only the wiki row when collapsed", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);

    expect(screen.getByTestId("wiki-list-item-open-wiki-1")).toHaveTextContent(
      /Public Wiki/,
    );
    expect(screen.queryByRole("treeitem", { name: /api/ })).toBeNull();
  });

  it("renders wiki.icon in place of the default LibraryIcon when present", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    const withIcon = { ...wiki, icon: "📚" };
    render(<WikiListItem wiki={withIcon} />);

    const iconBadge = screen.getByTestId("wiki-list-item-icon-wiki-1");
    expect(iconBadge).toHaveTextContent("📚");
  });

  it("uses the root index frontmatter title and icon while the wiki row is active", () => {
    act(() => {
      useWikiStore.getState().setSelectedWiki("wiki-1");
      useWikiStore.getState().setSelectedPage("index.md9");
    });
    mockUseWikiTree.mockReturnValue({ data: undefined });
    mockUseWikiPage.mockReturnValue({
      data: {
        path: "index.md9",
        content: "",
        encoding: "text",
        frontmatter: { title: "Public Handbook", icon: "📘" },
        lastCommit: null,
      },
    });

    render(<WikiListItem wiki={wiki} />);

    expect(screen.getByTestId("wiki-list-item-open-wiki-1")).toHaveTextContent(
      /Public Handbook/,
    );
    expect(screen.getByTestId("wiki-list-item-icon-wiki-1")).toHaveTextContent(
      "📘",
    );
  });

  it("uses the row create button as a create menu trigger", async () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    mockUseWikiTree.mockReturnValue({ data: [] });

    render(<WikiListItem wiki={wiki} />);

    fireEvent.click(screen.getByTestId("wiki-list-item-create-wiki-1"));

    expect(
      screen.getByRole("menuitem", { name: /new page/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /^upload$/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /new folder/i })).toBeNull();
  });

  it("opens a create menu from the row plus button", async () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    mockUseWikiTree.mockReturnValue({ data: [] });

    render(<WikiListItem wiki={wiki} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-create-wiki-1"));
    });

    expect(window.prompt).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("wiki-list-item-create-page-wiki-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("wiki-list-item-upload-wiki-1"),
    ).toBeInTheDocument();
  });

  it("creates a new page folder directly from the create menu", async () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    mockUseWikiTree.mockReturnValue({ data: [] });

    render(<WikiListItem wiki={wiki} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-create-wiki-1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-create-page-wiki-1"));
    });

    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledWith("wiki-1", {
        message: "Create untitled/index.md9",
        files: [
          {
            path: "untitled/index.md9",
            content: '---\nsummary: ""\n---\n\n# untitled\n\n',
            encoding: "text",
            action: "create",
          },
        ],
      });
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/wiki/$wikiSlug/$",
        params: { wikiSlug: "public", _splat: "untitled/index.md9" },
      });
    });
  });

  it("deduplicates new page folders by renaming the folder segment", async () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    mockUseWikiTree.mockReturnValue({
      data: [
        {
          name: "index.md9",
          path: "untitled/index.md9",
          type: "file",
          size: 1,
        },
      ],
    });

    render(<WikiListItem wiki={wiki} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-create-wiki-1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-create-page-wiki-1"));
    });

    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledWith("wiki-1", {
        message: "Create untitled-2/index.md9",
        files: [
          {
            path: "untitled-2/index.md9",
            content: '---\nsummary: ""\n---\n\n# untitled-2\n\n',
            encoding: "text",
            action: "create",
          },
        ],
      });
    });
  });

  it("creates a child page from a tree node plus button", async () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    mockUseWikiTree.mockReturnValue({ data: treeEntries });

    render(<WikiListItem wiki={wiki} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-tree-node-create-api"));
    });

    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledWith("wiki-1", {
        message: "Create api/untitled/index.md9",
        files: [
          {
            path: "api/untitled/index.md9",
            content: '---\nsummary: ""\n---\n\n# untitled\n\n',
            encoding: "text",
            action: "create",
          },
        ],
      });
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: "public", _splat: "api/untitled/index.md9" },
    });
  });

  it("opens an upload modal from the create menu", async () => {
    mockUseWikiTree.mockReturnValue({ data: [] });
    render(<WikiListItem wiki={wiki} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-create-wiki-1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-upload-wiki-1"));
    });

    expect(
      screen.getByTestId("wiki-list-item-upload-dialog-wiki-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("wiki-list-item-upload-picker-wiki-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("wiki-list-item-upload-file-input-wiki-1"),
    ).toHaveAttribute("multiple");
    expect(screen.queryByText(/select folder/i)).toBeNull();
  });

  it("uploads selected files through a wiki proposal", async () => {
    mockCommit.mockResolvedValueOnce({
      commit: { sha: "sha-upload" },
      proposal: { id: "proposal-1", status: "pending" },
    });
    mockUseWikiTree.mockReturnValue({ data: [] });
    render(<WikiListItem wiki={wiki} />);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-create-wiki-1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-upload-wiki-1"));
    });
    await act(async () => {
      fireEvent.change(
        screen.getByTestId("wiki-list-item-upload-file-input-wiki-1"),
        { target: { files: [file] } },
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-upload-submit-wiki-1"),
      );
    });

    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledWith("wiki-1", {
        message: "Upload 1 file",
        files: [
          {
            path: "notes.txt",
            content: "aGVsbG8=",
            encoding: "base64",
            action: "create",
          },
        ],
        propose: true,
      });
    });
    expect(
      screen.getByTestId("wiki-list-item-upload-ai-status-wiki-1"),
    ).toHaveTextContent(/proposal-1/);
  });

  it("uploads multiple selected files through one wiki proposal", async () => {
    mockCommit.mockResolvedValueOnce({
      commit: { sha: "sha-upload" },
      proposal: { id: "proposal-many", status: "pending" },
    });
    mockUseWikiTree.mockReturnValue({ data: [] });
    render(<WikiListItem wiki={wiki} />);
    const notes = new File(["hello"], "notes.txt", { type: "text/plain" });
    const plan = new File(["plan"], "plan.md", { type: "text/markdown" });

    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-create-wiki-1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-upload-wiki-1"));
    });
    await act(async () => {
      fireEvent.change(
        screen.getByTestId("wiki-list-item-upload-file-input-wiki-1"),
        { target: { files: [notes, plan] } },
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-upload-submit-wiki-1"),
      );
    });

    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledWith("wiki-1", {
        message: "Upload 2 files",
        files: [
          {
            path: "notes.txt",
            content: "aGVsbG8=",
            encoding: "base64",
            action: "create",
          },
          {
            path: "plan.md",
            content: "cGxhbg==",
            encoding: "base64",
            action: "create",
          },
        ],
        propose: true,
      });
    });
  });

  it("preserves folder-relative paths when uploading a folder", async () => {
    mockCommit.mockResolvedValueOnce({
      commit: { sha: "sha-upload" },
      proposal: { id: "proposal-2", status: "pending" },
    });
    mockUseWikiTree.mockReturnValue({ data: [] });
    render(<WikiListItem wiki={wiki} />);
    const file = new File(["folder file"], "guide.md", {
      type: "text/markdown",
    });
    Object.defineProperty(file, "webkitRelativePath", {
      value: "docs/guide.md",
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-create-wiki-1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-upload-wiki-1"));
    });
    await act(async () => {
      fireEvent.change(
        screen.getByTestId("wiki-list-item-upload-file-input-wiki-1"),
        { target: { files: [file] } },
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-upload-submit-wiki-1"),
      );
    });

    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalledWith(
        "wiki-1",
        expect.objectContaining({
          files: [
            expect.objectContaining({
              path: "docs/guide.md",
              content: "Zm9sZGVyIGZpbGU=",
              encoding: "base64",
              action: "create",
            }),
          ],
          propose: true,
        }),
      );
    });
  });

  it("falls back to the default LibraryIcon when wiki.icon is null", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);

    expect(screen.queryByTestId("wiki-list-item-icon-wiki-1")).toBeNull();
  });

  it("toggles via the wiki:<id> key in the shared store", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);

    fireEvent.click(screen.getByTestId("wiki-list-item-toggle-wiki-1"));

    expect(useWikiStore.getState().expandedDirectories.has("wiki:wiki-1")).toBe(
      true,
    );
  });

  it("opens the root index document when the wiki name is clicked", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);

    fireEvent.click(screen.getByTestId("wiki-list-item-open-wiki-1"));

    const state = useWikiStore.getState();
    expect(state.expandedDirectories.has("wiki:wiki-1")).toBe(true);
    expect(state.selectedWikiId).toBe("wiki-1");
    expect(state.selectedPagePath).toBe("index.md9");
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug/$",
      params: { wikiSlug: "public", _splat: "index.md9" },
    });
  });

  it("fetches the tree and renders tree nodes once expanded", () => {
    // Pre-expand so the first render passes the wiki id into the hook.
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    mockUseWikiTree.mockReturnValue({ data: treeEntries });

    render(<WikiListItem wiki={wiki} />);

    expect(mockUseWikiTree).toHaveBeenCalledWith("wiki-1");
    // Tree rows now present; `api` (dir). The root index.md9 is the wiki row's
    // folder document, so it is not rendered as a child file.
    // WikiTreeNode buttons carry role="treeitem" (A-3 fix). The outer
    // WikiListItem div also has role="treeitem", so accessible names are
    // shared across levels — use getAllByRole to avoid "multiple elements" error.
    expect(
      screen.getAllByRole("treeitem", { name: /^api$/ }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("treeitem", { name: /^index$/ })).toBeNull();
  });

  it("highlights the wiki row when the root index document is selected", () => {
    act(() => {
      useWikiStore.getState().setSelectedWiki("wiki-1");
      useWikiStore.getState().setSelectedPage("index.md9");
    });
    mockUseWikiTree.mockReturnValue({ data: undefined });

    const { container } = render(<WikiListItem wiki={wiki} />);

    const row = container.querySelector(".group\\/wiki-row > div");
    expect(row).toHaveClass(
      "bg-[var(--nav-active)]",
      "text-[var(--nav-foreground-strong)]",
      "font-medium",
    );
    expect(row).not.toHaveClass("bg-primary/10", "text-primary");
  });

  it("renders an empty tree without crashing while loading", () => {
    act(() => {
      useWikiStore.getState().toggleDirectory("wiki:wiki-1");
    });
    mockUseWikiTree.mockReturnValue({ data: undefined });

    render(<WikiListItem wiki={wiki} />);

    // Only the wiki row is present — no tree rows yet.
    expect(screen.getByTestId("wiki-list-item-open-wiki-1")).toHaveTextContent(
      /Public Wiki/,
    );
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

  it("renders the kebab trigger with an accessible label", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    const kebab = screen.getByTestId("wiki-list-item-kebab-wiki-1");
    expect(kebab).toBeInTheDocument();
    expect(kebab).toHaveAttribute("aria-label", "Public Wiki actions");
  });

  it("renders the create menu trigger with an accessible label", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    const create = screen.getByTestId("wiki-list-item-create-wiki-1");
    expect(create).toBeInTheDocument();
    expect(create).toHaveAttribute("aria-label", "Create in Public Wiki");
  });

  it("raises low-contrast wiki row icons to foreground on row hover", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    const { container } = render(<WikiListItem wiki={wiki} />);

    const libraryIcon = container.querySelector(".lucide-library");
    expect(libraryIcon).toHaveClass("group-hover/wiki-row:text-foreground");
    expect(screen.getByTestId("wiki-list-item-kebab-wiki-1")).toHaveClass(
      "group-hover/wiki-row:text-foreground",
    );
    expect(screen.getByTestId("wiki-list-item-create-wiki-1")).toHaveClass(
      "group-hover/wiki-row:text-foreground",
    );
  });

  it("uses a light hover background for wiki rows", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    const { container } = render(<WikiListItem wiki={wiki} />);

    const row = container.querySelector(".group\\/wiki-row > div");
    expect(row).toHaveClass("hover:bg-muted/50");
    expect(row).not.toHaveClass("hover:bg-accent");
  });

  it("kebab click does NOT toggle the row expansion", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    // Row still collapsed.
    expect(useWikiStore.getState().expandedDirectories.has("wiki:wiki-1")).toBe(
      false,
    );
  });

  it("create menu click does NOT toggle the row expansion", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    fireEvent.click(screen.getByTestId("wiki-list-item-create-wiki-1"));
    expect(useWikiStore.getState().expandedDirectories.has("wiki:wiki-1")).toBe(
      false,
    );
  });

  it("opens the Settings dialog when the Settings menu item is clicked", async () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    // Open the kebab menu.
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    // Menu items are rendered through a Radix portal into the body.
    const settingsItem = await screen.findByTestId(
      "wiki-list-item-settings-wiki-1",
    );
    await act(async () => {
      fireEvent.click(settingsItem);
    });
    expect(screen.getByTestId("mock-settings-dialog")).toHaveAttribute(
      "data-wiki-id",
      "wiki-1",
    );
  });

  it("closes the Settings dialog via the shim's close handler", async () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const settingsItem = await screen.findByTestId(
      "wiki-list-item-settings-wiki-1",
    );
    await act(async () => {
      fireEvent.click(settingsItem);
    });
    expect(screen.getByTestId("mock-settings-dialog")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-settings-close"));
    });
    expect(screen.queryByTestId("mock-settings-dialog")).toBeNull();
  });

  it("opens the Archive confirmation when Archive is clicked", async () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const archiveItem = await screen.findByTestId(
      "wiki-list-item-archive-wiki-1",
    );
    await act(async () => {
      fireEvent.click(archiveItem);
    });
    expect(
      screen.getByTestId("wiki-list-item-archive-confirm-wiki-1"),
    ).toBeInTheDocument();
  });

  it("confirming Archive calls useArchiveWiki with the wiki id", async () => {
    archiveMutateAsync.mockResolvedValueOnce(undefined);
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const archiveItem = await screen.findByTestId(
      "wiki-list-item-archive-wiki-1",
    );
    await act(async () => {
      fireEvent.click(archiveItem);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-archive-confirm-button-wiki-1"),
      );
    });
    expect(archiveMutateAsync).toHaveBeenCalledWith("wiki-1");
  });

  it("after archiving, if this wiki is currently selected, navigates to /wiki", async () => {
    archiveMutateAsync.mockResolvedValueOnce(undefined);
    mockUseWikiTree.mockReturnValue({ data: undefined });
    // Mimic the user being at /wiki/<this-wiki-slug>/...
    act(() => {
      useWikiStore.getState().setSelectedWiki("wiki-1");
    });
    render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const archiveItem = await screen.findByTestId(
      "wiki-list-item-archive-wiki-1",
    );
    await act(async () => {
      fireEvent.click(archiveItem);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-archive-confirm-button-wiki-1"),
      );
    });
    expect(archiveMutateAsync).toHaveBeenCalledWith("wiki-1");
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/wiki" });
  });

  it("after archiving, if a DIFFERENT wiki is selected, does NOT navigate", async () => {
    archiveMutateAsync.mockResolvedValueOnce(undefined);
    mockUseWikiTree.mockReturnValue({ data: undefined });
    act(() => {
      useWikiStore.getState().setSelectedWiki("some-other-wiki");
    });
    render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const archiveItem = await screen.findByTestId(
      "wiki-list-item-archive-wiki-1",
    );
    await act(async () => {
      fireEvent.click(archiveItem);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-archive-confirm-button-wiki-1"),
      );
    });
    expect(archiveMutateAsync).toHaveBeenCalledWith("wiki-1");
    // Viewer was on a different wiki → URL doesn't need to change.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("after archiving, if no wiki is selected, does NOT navigate", async () => {
    archiveMutateAsync.mockResolvedValueOnce(undefined);
    mockUseWikiTree.mockReturnValue({ data: undefined });
    // selectedWikiId remains null (default / reset in beforeEach).
    render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const archiveItem = await screen.findByTestId(
      "wiki-list-item-archive-wiki-1",
    );
    await act(async () => {
      fireEvent.click(archiveItem);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-archive-confirm-button-wiki-1"),
      );
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("cancelling Archive does not fire the mutation", async () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const archiveItem = await screen.findByTestId(
      "wiki-list-item-archive-wiki-1",
    );
    await act(async () => {
      fireEvent.click(archiveItem);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-archive-cancel-wiki-1"),
      );
    });
    expect(archiveMutateAsync).not.toHaveBeenCalled();
  });

  it("archive failure surfaces a window.alert with the error message", async () => {
    archiveMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), {
        status: 403,
        response: { status: 403, data: { message: "forbidden" } },
      }),
    );
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const archiveItem = await screen.findByTestId(
      "wiki-list-item-archive-wiki-1",
    );
    await act(async () => {
      fireEvent.click(archiveItem);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-archive-confirm-button-wiki-1"),
      );
    });
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringMatching(/permission/i),
    );
  });

  it("archive failure without a body falls back to the generic message", async () => {
    archiveMutateAsync.mockRejectedValueOnce(new Error(""));
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const archiveItem = await screen.findByTestId(
      "wiki-list-item-archive-wiki-1",
    );
    await act(async () => {
      fireEvent.click(archiveItem);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-archive-confirm-button-wiki-1"),
      );
    });
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringMatching(/archive failed\. please try again/i),
    );
  });

  it("archive failure with a server message surfaces it to the alert", async () => {
    archiveMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error("boom"), {
        status: 500,
        response: { status: 500, data: { message: "boom" } },
      }),
    );
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const archiveItem = await screen.findByTestId(
      "wiki-list-item-archive-wiki-1",
    );
    await act(async () => {
      fireEvent.click(archiveItem);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-archive-confirm-button-wiki-1"),
      );
    });
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringMatching(/archive failed: boom/i),
    );
  });

  it("confirm button disables and swaps label while the archive mutation is in flight", async () => {
    let releaseResolver!: () => void;
    archiveMutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseResolver = resolve;
        }),
    );
    mockUseWikiTree.mockReturnValue({ data: undefined });
    const { rerender } = render(<WikiListItem wiki={wiki} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    });
    const archiveItem = await screen.findByTestId(
      "wiki-list-item-archive-wiki-1",
    );
    await act(async () => {
      fireEvent.click(archiveItem);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("wiki-list-item-archive-confirm-button-wiki-1"),
      );
    });
    // Simulate React Query flipping isPending.
    archivePending.value = true;
    act(() => {
      rerender(<WikiListItem wiki={wiki} />);
    });
    expect(
      screen.getByTestId("wiki-list-item-archive-confirm-button-wiki-1"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("wiki-list-item-archive-confirm-button-wiki-1"),
    ).toHaveTextContent(/archiving…/i);
    // The disabled attribute on the confirm button is the sole guard —
    // we just verify the first click is still the only mutation attempt.
    expect(archiveMutateAsync).toHaveBeenCalledTimes(1);
    // Resolve the pending promise so the component settles cleanly —
    // wrap in act() to absorb the trailing state updates.
    await act(async () => {
      releaseResolver();
      await Promise.resolve();
    });
  });
});
