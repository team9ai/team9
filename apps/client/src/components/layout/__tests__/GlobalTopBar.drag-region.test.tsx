import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockToggleSidebarCollapsed = vi.hoisted(() => vi.fn());
const mockUpdateQuery = vi.hoisted(() => vi.fn());
const mockClearSearch = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "searchPlaceholder" ? "Search..." : key),
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/stores", () => ({
  useUser: () => ({ data: null }),
  useWorkspaceStore: () => ({
    selectedWorkspaceId: "ws-1",
  }),
  useSidebarCollapsed: () => false,
  appActions: {
    toggleSidebarCollapsed: mockToggleSidebarCollapsed,
  },
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useUserWorkspaces: () => ({
    data: [{ id: "ws-1", name: "Workspace" }],
  }),
}));

vi.mock("@/hooks/useSearch", () => ({
  useDebouncedQuickSearch: () => ({
    searchQuery: "",
    updateQuery: mockUpdateQuery,
    clearSearch: mockClearSearch,
    data: [],
    isLoading: false,
    isFetching: false,
  }),
}));

vi.mock("@/lib/tauri", () => ({
  alignMacTrafficLights: vi.fn(),
  isMacTauriApp: () => false,
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ className, ...props }: React.ComponentProps<"input">) => (
    <input className={className} {...props} />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    onClick,
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/search/QuickSearchResults", () => ({
  QuickSearchResults: () => <div>results</div>,
}));

import { GlobalTopBar } from "../GlobalTopBar";

describe("GlobalTopBar drag regions", () => {
  it("marks the non-interactive top-bar containers as draggable", () => {
    const { container } = render(<GlobalTopBar />);

    expect(container.querySelector("header[data-tauri-drag-region]")).not.toBe(
      null,
    );
    expect(container.querySelectorAll("[data-tauri-drag-region]").length).toBe(
      5,
    );
    expect(screen.getByRole("button")).not.toHaveAttribute(
      "data-tauri-drag-region",
    );
    expect(screen.getByRole("textbox")).not.toHaveAttribute(
      "data-tauri-drag-region",
    );
  });
});
