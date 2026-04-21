import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiListItem } from "../WikiListItem";
import { useWikiStore } from "@/stores/useWikiStore";
import type { WikiDto, TreeEntryDto } from "@/types/wiki";

const mockUseWikiTree = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const archiveMutateAsync = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<void>>(),
);
const archivePending = vi.hoisted(() => ({ value: false }));

vi.mock("@/hooks/useWikiTree", () => ({
  useWikiTree: (...args: unknown[]) => mockUseWikiTree(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
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
    archiveMutateAsync.mockReset();
    archivePending.value = false;
    document.body.innerHTML = "";
    vi.spyOn(window, "alert").mockImplementation(() => {});
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
      screen.getByTestId("wiki-list-item-toggle-wiki-1"),
    ).toHaveTextContent(/Public Wiki/);
    expect(screen.queryByRole("button", { name: /api/ })).toBeNull();
  });

  it("toggles via the wiki:<id> key in the shared store", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);

    fireEvent.click(screen.getByTestId("wiki-list-item-toggle-wiki-1"));

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
      screen.getByTestId("wiki-list-item-toggle-wiki-1"),
    ).toHaveTextContent(/Public Wiki/);
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

  it("kebab click does NOT toggle the row expansion", () => {
    mockUseWikiTree.mockReturnValue({ data: undefined });
    render(<WikiListItem wiki={wiki} />);
    fireEvent.click(screen.getByTestId("wiki-list-item-kebab-wiki-1"));
    // Row still collapsed.
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
