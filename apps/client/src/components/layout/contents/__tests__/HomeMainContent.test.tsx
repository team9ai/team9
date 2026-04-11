import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseChannelsByType = vi.hoisted(() => vi.fn());
const mockUseCreateDirectChannel = vi.hoisted(() => vi.fn());
const mockUseDashboardAgents = vi.hoisted(() => vi.fn());
const mockUpdateAgentModel = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingOverview = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingSummary = vi.hoisted(() => vi.fn());
const mockUseSelectedWorkspaceId = vi.hoisted(() => vi.fn());
const mockUseUser = vi.hoisted(() => vi.fn());

const translationMap: Record<
  string,
  string | ((options?: Record<string, unknown>) => string)
> = {
  dashboardTitle: "What can I help you with today?",
  dashboardPromptPlaceholder: "Message dashboard...",
  dashboardModelLabel: "GPT5.4",
  dashboardPromptHint: "Press Enter to send. Use Shift+Enter for a new line.",
  dashboardActionDeepResearch: "Deep research",
  dashboardActionGenerateImage: "Generate image",
  dashboardPlan: "Free plan",
  dashboardUpgrade: "Upgrade",
  dashboardUsageValue: "1,280",
  dashboardBrand: "Team9 Agent",
  dashboardWarmupNotice: (options) =>
    `Your OpenClaw is warming up. ${options?.name ?? ""}`,
  dashboardNoBotDescription: "Create or activate an AI staff member",
  dashboardCreateAiStaffCta: "Go to AI Staff",
  dashboardMockLabel: "Mock",
  dashboardTaskEmptyValue: "None",
  dashboardNoActiveTask: "No active task",
  dashboardCreateTask: "Create",
  sendMessage: "Send message",
  cancel: "Cancel",
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

vi.mock("@/hooks/useChannels", () => ({
  useChannelsByType: mockUseChannelsByType,
  useCreateDirectChannel: mockUseCreateDirectChannel,
}));

vi.mock("@/hooks/useDashboardAgents", () => ({
  useDashboardAgents: mockUseDashboardAgents,
}));

vi.mock("@/hooks/useWorkspaceBilling", () => ({
  useWorkspaceBillingOverview: mockUseWorkspaceBillingOverview,
  useWorkspaceBillingSummary: mockUseWorkspaceBillingSummary,
}));

vi.mock("@/stores", () => ({
  useSelectedWorkspaceId: mockUseSelectedWorkspaceId,
  useUser: mockUseUser,
}));

import { HomeMainContent } from "../HomeMainContent";

describe("HomeMainContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseSelectedWorkspaceId.mockReturnValue("ws-1");
    mockUseWorkspaceBillingSummary.mockReturnValue({
      data: {
        subscription: {
          product: {
            name: "Starter",
          },
        },
        managementAllowed: true,
      },
    });
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          balance: 4321,
          effectiveQuota: 555,
        },
      },
    });
    mockUseChannelsByType.mockReturnValue({
      directChannels: [{ id: "bot-ch-1", otherUser: { userType: "bot" } }],
    });
    mockUseCreateDirectChannel.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    mockUseDashboardAgents.mockReturnValue({
      agents: [
        {
          userId: "agent-1",
          botId: "bot-1",
          channelId: "bot-ch-1",
          label: "Alpha Agent",
          username: "alpha_agent",
          applicationId: "common-staff",
          installedApplicationId: "app-1",
          agentType: null,
          hasExistingChannel: true,
          model: { provider: "openrouter", id: "openai/gpt-4.1" },
          managedAgentId: "common-staff-bot-1",
          canSwitchModel: true,
        },
        {
          userId: "agent-2",
          botId: "bot-2",
          channelId: "bot-ch-2",
          label: "Beta Agent",
          username: "beta_agent",
          applicationId: "common-staff",
          installedApplicationId: "app-1",
          agentType: null,
          hasExistingChannel: true,
          model: { provider: "openrouter", id: "anthropic/claude-opus-4.6" },
          managedAgentId: "common-staff-bot-2",
          canSwitchModel: true,
        },
      ],
      updateAgentModel: mockUpdateAgentModel,
      updatingAgentUserId: null,
    });
    mockUseUser.mockReturnValue({
      createdAt: "2024-01-01T00:00:00.000Z",
      name: "OpenClaw",
    });
  });

  it("renders the dashboard with title and prompt input", () => {
    const { container } = render(<HomeMainContent />);

    expect(
      screen.getByRole("heading", {
        name: /what can i help you with today\?/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/message dashboard/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/deep research/i)).toBeInTheDocument();
    expect(screen.getByText(/generate image/i)).toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("4,876")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /alpha agent/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger.className).toContain("cursor-pointer");
    expect(container.querySelector('[data-slot="avatar"]')).not.toBeNull();
  });

  it("switches to the selected agent and submits to that agent channel", async () => {
    render(<HomeMainContent />);

    fireEvent.pointerDown(screen.getByRole("button", { name: /alpha agent/i }));
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: /beta agent/i }),
    );
    fireEvent.change(screen.getByPlaceholderText(/message dashboard/i), {
      target: { value: "hello beta" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/channels/$channelId",
      params: { channelId: "bot-ch-2" },
      search: { draft: "hello beta", autoSend: true },
    });
  });

  it("renders a fixed model pill for base-model agents", () => {
    mockUseDashboardAgents.mockReturnValue({
      agents: [
        {
          userId: "base-agent-1",
          botId: "base-bot-1",
          channelId: "bot-ch-1",
          label: "Claude",
          username: "claude_bot",
          applicationId: "base-model-staff",
          installedApplicationId: "app-base",
          agentType: "base_model",
          hasExistingChannel: true,
          model: null,
          managedAgentId: "base-model-claude-ws-1",
          canSwitchModel: false,
        },
      ],
      updateAgentModel: mockUpdateAgentModel,
      updatingAgentUserId: null,
    });

    render(<HomeMainContent />);

    expect(screen.getByText("Claude Sonnet 4.6")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /claude sonnet 4.6/i }),
    ).not.toBeInTheDocument();
  });

  it("updates the model when the selected agent supports switching", async () => {
    render(<HomeMainContent />);

    fireEvent.pointerDown(screen.getByRole("button", { name: /gpt-4.1/i }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /o3/i }));

    expect(mockUpdateAgentModel).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "agent-1" }),
      {
        provider: "openrouter",
        id: "openai/o3",
      },
    );
  });

  it("falls back to the free plan label when no subscription exists", () => {
    mockUseWorkspaceBillingSummary.mockReturnValue({
      data: {
        subscription: null,
        managementAllowed: false,
      },
    });
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: null,
    });

    render(<HomeMainContent />);

    expect(screen.getByText("Free plan")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
