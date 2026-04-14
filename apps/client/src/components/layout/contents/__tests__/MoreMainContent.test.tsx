import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseCurrentWorkspaceRole = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      if (typeof opts === "string") return opts;
      if (opts && typeof opts === "object") {
        let result = key;
        for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
          result = result.replace(`{{${k}}}`, String(v));
        }
        return result;
      }
      return key;
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

vi.mock("@/i18n", () => ({
  supportedLanguages: [{ code: "en", name: "English", nativeName: "English" }],
}));

vi.mock("@/i18n/loadLanguage", () => ({
  changeLanguage: vi.fn(),
  useLanguageLoading: () => false,
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

vi.mock("@/components/settings/NotificationPreferencesDialog", () => ({
  NotificationPreferencesDialog: () => null,
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

    expect(screen.queryByText("workspaceSettings")).not.toBeInTheDocument();
  });

  it("navigates to workspace settings from the workspace group", () => {
    mockUseCurrentWorkspaceRole.mockReturnValue({
      isOwner: false,
      isAdmin: true,
      isOwnerOrAdmin: true,
    });

    render(<MoreMainContent />);
    fireEvent.click(screen.getByText("workspaceSettings"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/more/workspace-settings",
    });
  });

  it("renders workspace settings as the first item in the workspace group", () => {
    mockUseCurrentWorkspaceRole.mockReturnValue({
      isOwner: true,
      isAdmin: false,
      isOwnerOrAdmin: true,
    });

    render(<MoreMainContent />);

    const workspaceItems = screen
      .getAllByText(/^(workspaceSettings|invitations|members)$/)
      .map((node) => node.textContent);

    expect(workspaceItems[0]).toBe("workspaceSettings");
    expect(workspaceItems).toEqual([
      "workspaceSettings",
      "invitations",
      "members",
    ]);
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
    // With the t() mock returning keys, copyright renders as "copyright"
    expect(screen.getByText("copyright")).toBeInTheDocument();
  });
});
