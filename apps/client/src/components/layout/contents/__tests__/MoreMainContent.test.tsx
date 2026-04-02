import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseCurrentWorkspaceRole = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useCurrentWorkspaceRole: mockUseCurrentWorkspaceRole,
}));

vi.mock("@/hooks/useTheme", () => ({
  useThemeToggle: () => ({
    theme: "light",
    setTheme: vi.fn(),
  }),
}));

vi.mock("@/stores", () => ({
  useWorkspaceStore: () => ({
    selectedWorkspaceId: "ws-1",
  }),
}));

vi.mock("@/components/workspace/InviteManagementDialog", () => ({
  InviteManagementDialog: () => null,
}));

import { MoreMainContent } from "../MoreMainContent";

describe("MoreMainContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows workspace settings only for owner or admin", () => {
    mockUseCurrentWorkspaceRole.mockReturnValue({
      isOwner: false,
      isAdmin: false,
      isOwnerOrAdmin: false,
    });

    render(<MoreMainContent />);

    expect(screen.queryByText(/workspace settings/i)).not.toBeInTheDocument();
  });

  it("navigates to workspace settings from the workspace group", () => {
    mockUseCurrentWorkspaceRole.mockReturnValue({
      isOwner: false,
      isAdmin: true,
      isOwnerOrAdmin: true,
    });

    render(<MoreMainContent />);
    fireEvent.click(screen.getByText(/workspace settings/i));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/more/workspace-settings",
    });
  });
});
