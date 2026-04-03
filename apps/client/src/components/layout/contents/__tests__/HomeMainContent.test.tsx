import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseUserWorkspaces = vi.hoisted(() => vi.fn());
const mockUseWorkspaceInvitations = vi.hoisted(() => vi.fn());
const mockUseCreateInvitation = vi.hoisted(() => vi.fn());
const mockUseChannelsByType = vi.hoisted(() => vi.fn());
const mockUseSelectedWorkspaceId = vi.hoisted(() => vi.fn());
const mockUseUser = vi.hoisted(() => vi.fn());

const translationMap: Record<
  string,
  string | ((options?: Record<string, unknown>) => string)
> = {
  welcomeBackTo: (options) => `Welcome back to ${options?.workspace}!`,
  workspaceActivity: "Here's what's happening in your workspace.",
  weeklyRoadmap: "This Month's Development Roadmap",
  roadmapCreateAIStaff: "Create AI Staff",
  roadmapAIStaffOnComputer: "AI Staff on Your Computer",
  roadmapBigToolUpdate: "Big Tool Update",
  roadmapNewUI: "New UI",
  roadmapDesktopApp: "Desktop App",
  roadmapGoogleWorkspace: "Google Workspace",
  roadmapMessagingIntegration: "Messaging Integration",
  roadmapScheduledTasks: "Scheduled Tasks",
  roadmapSkills: "Skills",
  roadmapModelSwitching: "Model Switching",
  supportedTools: "Supported Tools",
  chatWithOpenClaw: "Chat with OpenClaw",
  inviteFriends: "Add Teammates to Your Workspace",
  copied: "Copied",
  copyLink: "Copy Invite Link",
  createFirstChannel: "Create Your First Channel",
  createOwnAIStaff: "Create Your Own AI Staff",
  createChannelDescription:
    "Set up a channel and invite OpenClaw to collaborate with your team",
  joinBetaFeedback: "Join Early Beta Feedback",
  joinDiscord: "Join Discord",
  createChannel: "Create Channel",
  createAIStaff: "Create AI Staff",
  openclawWarmingUp: "Warm-up notice",
  "common:loading": "Loading",
  "navigation:copied": "Copied",
  "navigation:copyLink": "Copy Invite Link",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const entry = translationMap[key];

      if (typeof entry === "function") {
        return entry(options);
      }

      return entry ?? key;
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useUserWorkspaces: mockUseUserWorkspaces,
  useWorkspaceInvitations: mockUseWorkspaceInvitations,
  useCreateInvitation: mockUseCreateInvitation,
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannelsByType: mockUseChannelsByType,
}));

vi.mock("@/stores", () => ({
  useSelectedWorkspaceId: mockUseSelectedWorkspaceId,
  useUser: mockUseUser,
}));

vi.mock("@/components/dialog/CreateChannelDialog", () => ({
  CreateChannelDialog: () => null,
}));

import { HomeMainContent } from "../HomeMainContent";

describe("HomeMainContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseSelectedWorkspaceId.mockReturnValue("ws-1");
    mockUseUserWorkspaces.mockReturnValue({
      data: [{ id: "ws-1", name: "Alpha Workspace" }],
    });
    mockUseWorkspaceInvitations.mockReturnValue({
      data: [
        {
          id: "inv-1",
          url: "https://team9.ai/invite/abc",
          isActive: true,
          expiresAt: null,
          maxUses: null,
          usedCount: 0,
        },
      ],
    });
    mockUseCreateInvitation.mockReturnValue({ mutate: vi.fn() });
    mockUseChannelsByType.mockReturnValue({
      directChannels: [{ id: "bot-ch-1", otherUser: { userType: "bot" } }],
    });
    mockUseUser.mockReturnValue({
      createdAt: "2024-01-01T00:00:00.000Z",
      name: "OpenClaw",
    });
  });

  it("renders the workspace overview instead of the dashboard landing draft", () => {
    render(<HomeMainContent />);

    expect(
      screen.getByRole("heading", {
        name: /welcome back to alpha workspace!/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^team9$/i })).toBeInTheDocument();
    expect(screen.getByText(/supported tools/i)).toBeInTheDocument();
    expect(
      screen.getByText(/this month's development roadmap/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/what can i help you with today\?/i),
    ).not.toBeInTheDocument();
  });
});
