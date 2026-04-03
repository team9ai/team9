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

  it("hides unfinished settings entries and shows Team9 branding", () => {
    mockUseCurrentWorkspaceRole.mockReturnValue({
      isOwner: false,
      isAdmin: false,
      isOwnerOrAdmin: false,
    });

    render(<MoreMainContent />);

    expect(screen.queryByText(/^Notifications$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Privacy$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Help Center$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^About$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Team9" })).toHaveAttribute(
      "src",
      "/team9-block.png",
    );
    expect(screen.getByRole("img", { name: "Team9" })).toHaveAttribute(
      "width",
      "80",
    );
    expect(screen.queryByText(/^team9$/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/^© 2026 Team9\. All rights reserved\.$/),
    ).toBeInTheDocument();
  });
});
