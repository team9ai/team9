import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseChannelsByType = vi.hoisted(() => vi.fn());
const mockUseDashboardAgents = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingOverview = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingSummary = vi.hoisted(() => vi.fn());
const mockUseSelectedWorkspaceId = vi.hoisted(() => vi.fn());
const mockUseUser = vi.hoisted(() => vi.fn());
const mockCreateTopicSessionMutate = vi.hoisted(() => vi.fn());
const mockUseCreateTopicSession = vi.hoisted(() => vi.fn());

const translationMap: Record<
  string,
  string | ((options?: Record<string, unknown>) => string)
> = {
  dashboardTitle: "What can I help you with today?",
  dashboardPromptPlaceholder: "Message dashboard...",
  dashboardModelLabel: "GPT5.4",
  dashboardPromptHint: "Press Enter to send. Use Shift+Enter for a new line.",
  dashboardActionDeepResearch: "Deep research",
  dashboardDeepResearchTemplate: "Please run a deep research task...",
  dashboardActionVideoGeneration: "Create video",
  dashboardVideoGenerationTemplate: "Please generate a short video...",
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

vi.mock("@/hooks/useTopicSessions", () => ({
  useCreateTopicSession: mockUseCreateTopicSession,
}));

import { HomeMainContent } from "../HomeMainContent";

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

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
          grantBalance: 999,
          effectiveQuota: 555,
        },
      },
    });
    mockUseChannelsByType.mockReturnValue({
      directChannels: [{ id: "bot-ch-1", otherUser: { userType: "bot" } }],
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
          agentModelFamily: null,
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
          agentModelFamily: null,
        },
      ],
    });
    mockUseUser.mockReturnValue({
      createdAt: "2024-01-01T00:00:00.000Z",
      name: "OpenClaw",
    });
    // Default: topic-session creation resolves to a fresh channel id so the
    // dashboard can navigate into the newly-created topic channel.
    mockCreateTopicSessionMutate.mockResolvedValue({
      channelId: "topic-ch-new",
      sessionId: "session-new",
      agentId: "agent-hive-id",
      botUserId: "bot-2",
      title: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    mockUseCreateTopicSession.mockReturnValue({
      mutateAsync: mockCreateTopicSessionMutate,
      isPending: false,
    });
  });

  it("renders the dashboard with title and prompt input", () => {
    const { container } = renderWithProviders(<HomeMainContent />);

    expect(
      screen.getByRole("heading", {
        name: /what can i help you with today\?/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/message dashboard/i),
    ).toBeInTheDocument();
    // Video generation chip injects a prompt template that routes through the
    // normal topic-session pipeline — no special endpoints.
    expect(screen.getByText(/create video/i)).toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("5,875")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /alpha agent/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger.className).toContain("cursor-pointer");
    expect(container.querySelector('[data-slot="avatar"]')).not.toBeNull();
  });

  it("creates a topic session for the selected agent and navigates to the new channel", async () => {
    renderWithProviders(<HomeMainContent />);

    fireEvent.pointerDown(screen.getByRole("button", { name: /alpha agent/i }));
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: /beta agent/i }),
    );
    fireEvent.change(screen.getByPlaceholderText(/message dashboard/i), {
      target: { value: "hello beta" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    // Dashboard submit no longer routes to an existing bot channel with a
    // draft query param — it creates a fresh topic session for the selected
    // agent and navigates directly to the channel the server returned.
    await vi.waitFor(() => {
      expect(mockCreateTopicSessionMutate).toHaveBeenCalledWith({
        botUserId: "agent-2",
        initialMessage: "hello beta",
        model: { provider: "openrouter", id: "anthropic/claude-opus-4.6" },
      });
    });
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/channels/$channelId",
        params: { channelId: "topic-ch-new" },
      });
    });
  });

  it("shows a static model label for unrecognized base-model agents that cannot switch", () => {
    mockUseDashboardAgents.mockReturnValue({
      agents: [
        {
          userId: "base-agent-mystery",
          botId: "mystery-bot",
          channelId: "bot-ch-mystery",
          label: "Mystery",
          username: "mystery_bot",
          applicationId: "base-model-staff",
          installedApplicationId: "app-base",
          agentType: "base_model",
          hasExistingChannel: true,
          model: null,
          managedAgentId: "base-model-mystery-ws-1",
          canSwitchModel: false,
          agentModelFamily: null,
        },
      ],
    });

    renderWithProviders(<HomeMainContent />);

    // Fallback label from translation map for the read-only pill.
    expect(screen.getByText("GPT5.4")).toBeInTheDocument();
  });

  it("shows only family-matching models in the picker for a recognized Claude base-model agent", async () => {
    mockUseDashboardAgents.mockReturnValue({
      agents: [
        {
          userId: "base-agent-claude",
          botId: "claude-bot",
          channelId: "bot-ch-claude",
          label: "Claude",
          username: "claude_bot",
          applicationId: "base-model-staff",
          installedApplicationId: "app-base",
          agentType: "base_model",
          hasExistingChannel: true,
          model: null,
          managedAgentId: "base-model-claude-ws-1",
          canSwitchModel: true,
          agentModelFamily: "anthropic",
        },
      ],
    });

    renderWithProviders(<HomeMainContent />);

    // The composer model trigger shows the family default label
    // (Claude Sonnet 4.6) because no override is selected yet.
    const trigger = screen.getByRole("button", { name: /claude sonnet 4\.6/i });
    fireEvent.pointerDown(trigger);

    // Both Anthropic models present.
    expect(
      await screen.findByRole("menuitemradio", { name: /claude opus 4\.7/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemradio", { name: /claude sonnet 4\.6/i }),
    ).toBeInTheDocument();

    // Non-Anthropic models filtered out.
    expect(
      screen.queryByRole("menuitemradio", { name: /gpt-5\.4/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitemradio", { name: /gemini/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitemradio", { name: /qwen/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the model picker button for switchable agents", () => {
    renderWithProviders(<HomeMainContent />);

    expect(
      screen.getByRole("button", { name: /gpt-4.1/i }),
    ).toBeInTheDocument();
  });

  it("keeps the dashboard model menu visually minimal", async () => {
    renderWithProviders(<HomeMainContent />);

    fireEvent.pointerDown(screen.getByRole("button", { name: /gpt-4.1/i }));

    expect(await screen.findByText("Gemini 3.1 Pro")).toBeInTheDocument();
    expect(screen.getByText("Gemini 3 Flash")).toBeInTheDocument();
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    expect(screen.queryByText("Google")).not.toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toHaveClass("w-max");
    expect(screen.getByRole("menu")).not.toHaveClass("w-[12.5rem]");

    const menu = within(screen.getByRole("menu"));
    expect(menu.getAllByRole("img", { name: "Claude logo" })).toHaveLength(2);
    expect(menu.getAllByRole("img", { name: "ChatGPT logo" })).toHaveLength(2);
    expect(menu.getAllByRole("img", { name: "Gemini logo" })).toHaveLength(2);
    expect(menu.getByRole("img", { name: "Qwen logo" })).toBeInTheDocument();
    expect(menu.getByRole("img", { name: "GLM logo" })).toBeInTheDocument();
    expect(menu.getByRole("img", { name: "Kimi logo" })).toBeInTheDocument();
  });

  it("defaults to the personal-staff agent when one exists", () => {
    mockUseDashboardAgents.mockReturnValue({
      agents: [
        {
          userId: "agent-claude",
          botId: "claude-bot",
          channelId: "bot-ch-claude",
          label: "Claude",
          username: "claude_bot",
          applicationId: "base-model-staff",
          installedApplicationId: "app-base",
          agentType: "base_model",
          hasExistingChannel: true,
          model: null,
          managedAgentId: "base-model-claude-ws-1",
          canSwitchModel: false,
          agentModelFamily: null,
        },
        {
          userId: "agent-personal",
          botId: "personal-bot",
          channelId: "bot-ch-personal",
          label: "私人秘书",
          username: "personal_secretary",
          applicationId: "personal-staff",
          installedApplicationId: "app-personal",
          agentType: null,
          hasExistingChannel: true,
          model: { provider: "openrouter", id: "openai/gpt-4.1" },
          managedAgentId: null,
          canSwitchModel: true,
          agentModelFamily: null,
        },
      ],
    });

    renderWithProviders(<HomeMainContent />);

    expect(
      screen.getByRole("button", { name: /私人秘书/ }),
    ).toBeInTheDocument();
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

    renderWithProviders(<HomeMainContent />);

    expect(screen.getByText("Free plan")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the workspace credit balance to non-managing members", () => {
    // Members cannot manage billing but must still see the balance they
    // themselves consume when sending messages or running agents.
    mockUseWorkspaceBillingSummary.mockReturnValue({
      data: {
        subscription: { product: { name: "Starter" } },
        managementAllowed: false,
      },
    });
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          balance: 1000,
          grantBalance: 200,
          effectiveQuota: 50,
        },
      },
    });

    renderWithProviders(<HomeMainContent />);

    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});
