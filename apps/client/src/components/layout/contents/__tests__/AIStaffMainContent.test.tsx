import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledApplicationWithBots } from "@/services/api/applications";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockUseSelectedWorkspaceId = vi.hoisted(() => vi.fn());
const mockUseCurrentUser = vi.hoisted(() => vi.fn());
const mockUseWorkspaceMembers = vi.hoisted(() => vi.fn());
const mockCreateDMMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          aiStaff: "AI Staff",
          staff: "Staff",
          myPersonalStaff: "My Personal Staff",
          aiStaffSection: "AI Staff",
          membersSection: "Members",
          personalAssistant: "Personal Assistant",
          chatButton: "Chat",
          dmPermissionDenied:
            "This is a private assistant and is not open for direct messages.",
          createFirstAIStaff: "Create Your First AI Staff",
          aiStaffDescription: "Create AI staff members for your workspace.",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  useMutation: () => ({
    mutateAsync: mockCreateDMMutateAsync,
    mutate: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
  useInfiniteQuery: mockUseWorkspaceMembers,
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: mockUseSelectedWorkspaceId,
}));

vi.mock("@/stores", () => ({
  useSelectedWorkspaceId: mockUseSelectedWorkspaceId,
}));

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: mockUseCurrentUser,
}));

vi.mock("@/hooks/useChannels", () => ({
  useCreateDirectChannel: () => ({
    mutateAsync: mockCreateDMMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspaceMembers: () => mockUseWorkspaceMembers(),
}));

import { AIStaffMainContent } from "../AIStaffMainContent";

describe("AIStaffMainContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSelectedWorkspaceId.mockReturnValue("workspace-1");
    mockUseCurrentUser.mockReturnValue({ data: { id: "current-user-1" } });
    mockUseWorkspaceMembers.mockReturnValue({
      data: { pages: [{ members: [] }] },
      isLoading: false,
    });
  });

  it("renders model logos for base model staff bots", () => {
    const installedApps: InstalledApplicationWithBots[] = [
      {
        id: "base-model-app-1",
        applicationId: "base-model-staff",
        name: "Base Model Staff",
        description: "Default AI staff",
        tenantId: "workspace-1",
        installedBy: "user-1",
        config: {},
        permissions: {},
        status: "active",
        isActive: true,
        createdAt: "2026-04-03T00:00:00.000Z",
        updatedAt: "2026-04-03T00:00:00.000Z",
        type: "managed",
        bots: [
          {
            botId: "bot-claude-1",
            userId: "user-claude-1",
            agentType: "base_model",
            username: "claude_bot_workspace_1",
            displayName: "Claude",
            isActive: true,
            createdAt: "2026-04-03T00:00:00.000Z",
            managedMeta: {
              agentId: "base-model-claude-workspace-1",
            },
          },
        ],
        instanceStatus: null,
      },
    ];

    mockUseQuery.mockReturnValue({
      data: installedApps,
      isLoading: false,
      error: null,
    });

    render(<AIStaffMainContent />);

    expect(
      screen.getByRole("img", { name: "Claude logo" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("renders 3 sections: My Personal Staff, AI Staff, Members", () => {
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<AIStaffMainContent />);

    expect(screen.getByText("My Personal Staff")).toBeInTheDocument();
    expect(screen.getByText("AI Staff")).toBeInTheDocument();
    expect(screen.getByText("Members")).toBeInTheDocument();
  });

  it('shows header as "Staff" not "AI Staff"', () => {
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<AIStaffMainContent />);

    // The main header should say "Staff"
    const header = screen.getByRole("heading", { level: 2 });
    expect(header.textContent).toBe("Staff");
  });

  it("shows loading spinner when data is loading", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<AIStaffMainContent />);

    expect(screen.getByText("Staff")).toBeInTheDocument();
    // Loader2 renders as an SVG with animate-spin class
    const loader = document.querySelector(".animate-spin");
    expect(loader).toBeInTheDocument();
  });

  it("shows error state when query fails", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
    });

    render(<AIStaffMainContent />);

    expect(screen.getByText("Failed to load Staff")).toBeInTheDocument();
  });

  it("shows personal staff in My Personal Staff section", () => {
    const installedApps: InstalledApplicationWithBots[] = [
      {
        id: "ps-app-1",
        applicationId: "personal-staff",
        name: "Personal Staff",
        tenantId: "workspace-1",
        config: {},
        permissions: {},
        status: "active",
        isActive: true,
        createdAt: "2026-04-03T00:00:00.000Z",
        updatedAt: "2026-04-03T00:00:00.000Z",
        bots: [
          {
            botId: "ps-bot-1",
            userId: "ps-user-1",
            username: "my_assistant",
            displayName: "My Assistant",
            avatarUrl: null,
            ownerId: "current-user-1",
            persona: null,
            model: null,
            visibility: { allowMention: false, allowDirectMessage: false },
            isActive: true,
            createdAt: "2026-04-03T00:00:00.000Z",
            managedMeta: null,
          },
        ],
        instanceStatus: null,
      },
    ];

    mockUseQuery.mockReturnValue({
      data: installedApps,
      isLoading: false,
      error: null,
    });

    render(<AIStaffMainContent />);

    expect(screen.getByText("My Assistant")).toBeInTheDocument();
    // Should show Personal Assistant badge
    expect(screen.getByText("Personal Assistant")).toBeInTheDocument();
  });

  it("shows other users' visible personal staff in AI Staff section with lock icon", () => {
    const installedApps: InstalledApplicationWithBots[] = [
      {
        id: "ps-app-1",
        applicationId: "personal-staff",
        name: "Personal Staff",
        tenantId: "workspace-1",
        config: {},
        permissions: {},
        status: "active",
        isActive: true,
        createdAt: "2026-04-03T00:00:00.000Z",
        updatedAt: "2026-04-03T00:00:00.000Z",
        bots: [
          {
            botId: "ps-bot-2",
            userId: "ps-user-2",
            username: "other_assistant",
            displayName: "Other Assistant",
            avatarUrl: null,
            ownerId: "other-user-1",
            persona: null,
            model: null,
            visibility: { allowMention: true, allowDirectMessage: false },
            isActive: true,
            createdAt: "2026-04-03T00:00:00.000Z",
            managedMeta: null,
          },
        ],
        instanceStatus: null,
      },
    ];

    mockUseQuery.mockReturnValue({
      data: installedApps,
      isLoading: false,
      error: null,
    });

    render(<AIStaffMainContent />);

    // Should appear in AI Staff section (not My Personal Staff)
    expect(screen.getByText("Other Assistant")).toBeInTheDocument();
  });

  it("hides other users' personal staff with no visibility flags", () => {
    const installedApps: InstalledApplicationWithBots[] = [
      {
        id: "ps-app-1",
        applicationId: "personal-staff",
        name: "Personal Staff",
        tenantId: "workspace-1",
        config: {},
        permissions: {},
        status: "active",
        isActive: true,
        createdAt: "2026-04-03T00:00:00.000Z",
        updatedAt: "2026-04-03T00:00:00.000Z",
        bots: [
          {
            botId: "ps-bot-3",
            userId: "ps-user-3",
            username: "hidden_assistant",
            displayName: "Hidden Assistant",
            avatarUrl: null,
            ownerId: "other-user-2",
            persona: null,
            model: null,
            visibility: { allowMention: false, allowDirectMessage: false },
            isActive: true,
            createdAt: "2026-04-03T00:00:00.000Z",
            managedMeta: null,
          },
        ],
        instanceStatus: null,
      },
    ];

    mockUseQuery.mockReturnValue({
      data: installedApps,
      isLoading: false,
      error: null,
    });

    render(<AIStaffMainContent />);

    expect(screen.queryByText("Hidden Assistant")).not.toBeInTheDocument();
  });

  it("shows human members in Members section with Chat button", () => {
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    mockUseWorkspaceMembers.mockReturnValue({
      data: {
        pages: [
          {
            members: [
              {
                id: "member-1",
                userId: "human-1",
                username: "alice",
                displayName: "Alice",
                avatarUrl: null,
                role: "member",
                status: "online",
                userType: "human",
                joinedAt: "2026-01-01T00:00:00.000Z",
                lastSeenAt: null,
              },
            ],
          },
        ],
      },
      isLoading: false,
    });

    render(<AIStaffMainContent />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    // Chat button should be rendered
    const chatButtons = screen.getAllByText("Chat");
    expect(chatButtons.length).toBeGreaterThan(0);
  });

  it("creates DM and navigates when Chat button is clicked", async () => {
    mockCreateDMMutateAsync.mockResolvedValue({ id: "dm-channel-1" });

    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    mockUseWorkspaceMembers.mockReturnValue({
      data: {
        pages: [
          {
            members: [
              {
                id: "member-1",
                userId: "human-1",
                username: "alice",
                displayName: "Alice",
                avatarUrl: null,
                role: "member",
                status: "online",
                userType: "human",
                joinedAt: "2026-01-01T00:00:00.000Z",
                lastSeenAt: null,
              },
            ],
          },
        ],
      },
      isLoading: false,
    });

    render(<AIStaffMainContent />);

    const chatButton = screen.getAllByText("Chat")[0];
    fireEvent.click(chatButton);

    await waitFor(() => {
      expect(mockCreateDMMutateAsync).toHaveBeenCalledWith("human-1");
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/messages/$channelId",
        params: { channelId: "dm-channel-1" },
      });
    });
  });

  it("shows permission denied alert when DM to restricted personal staff fails with 403", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    // Mock the createDM to reject with a 403-like error
    const error403 = Object.assign(new Error("Forbidden"), {
      response: { status: 403, data: { message: "Forbidden" } },
    });
    mockCreateDMMutateAsync.mockRejectedValue(error403);

    const installedApps: InstalledApplicationWithBots[] = [
      {
        id: "ps-app-1",
        applicationId: "personal-staff",
        name: "Personal Staff",
        tenantId: "workspace-1",
        config: {},
        permissions: {},
        status: "active",
        isActive: true,
        createdAt: "2026-04-03T00:00:00.000Z",
        updatedAt: "2026-04-03T00:00:00.000Z",
        bots: [
          {
            botId: "ps-bot-restricted",
            userId: "ps-user-restricted",
            username: "restricted_bot",
            displayName: "Restricted Bot",
            avatarUrl: null,
            ownerId: "other-user-1",
            persona: null,
            model: null,
            visibility: { allowMention: true, allowDirectMessage: false },
            isActive: true,
            createdAt: "2026-04-03T00:00:00.000Z",
            managedMeta: null,
          },
        ],
        instanceStatus: null,
      },
    ];

    mockUseQuery.mockReturnValue({
      data: installedApps,
      isLoading: false,
      error: null,
    });

    render(<AIStaffMainContent />);

    const chatButtons = screen.getAllByText("Chat");
    fireEvent.click(chatButtons[0]);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "This is a private assistant and is not open for direct messages.",
      );
    });

    alertSpy.mockRestore();
  });
});
