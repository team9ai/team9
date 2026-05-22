import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseChannelsByType = vi.hoisted(() => vi.fn());
const mockUseDashboardAgents = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingOverview = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingSummary = vi.hoisted(() => vi.fn());
const mockUseSelectedWorkspaceId = vi.hoisted(() => vi.fn());
const mockUseUser = vi.hoisted(() => vi.fn());
const mockUseSkills = vi.hoisted(() => vi.fn());
const mockCreateTopicSessionMutate = vi.hoisted(() => vi.fn());
const mockUseCreateTopicSession = vi.hoisted(() => vi.fn());
const mockCreateTaskRun = vi.hoisted(() => vi.fn());
const mockUseFileUpload = vi.hoisted(() => vi.fn());
const mockUploadState = vi.hoisted(() => ({
  uploadingFiles: [] as Array<{
    id: string;
    file: File;
    progress: number;
    status: "completed";
    result: {
      key: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    };
  }>,
  addFiles: vi.fn(),
  removeFile: vi.fn((id: string) => {
    mockUploadState.uploadingFiles = mockUploadState.uploadingFiles.filter(
      (file) => file.id !== id,
    );
  }),
  retryFile: vi.fn(),
  clearFiles: vi.fn(() => {
    mockUploadState.uploadingFiles = [];
  }),
}));

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
  dashboardDeepResearchOptions: "Deep Research",
  dashboardDeepResearchModeStandard: "Research",
  dashboardDeepResearchModeMax: "Max",
  dashboardDeepResearchVisualsOn: "Visuals on",
  dashboardDeepResearchVisualsOff: "Visuals off",
  dashboardActionVideoGeneration: "Create video",
  dashboardVideoGenerationTemplate: "Please generate a short video...",
  dashboardActionSelectSkills: "Select skills",
  dashboardSkillsSelectedCount: (options) =>
    `${options?.count ?? 0} skills selected`,
  dashboardSkillsLoading: "Loading skills...",
  dashboardSkillsEmpty: "No skills available",
  dashboardModeSwitchLabel: "Dashboard mode",
  dashboardActionConversationMode: "Conversation mode",
  dashboardActionTaskMode: "Task mode",
  dashboardTaskTriggerSettings: "Task trigger settings",
  dashboardTaskExecuteImmediately: "Run after creation",
  dashboardTaskTriggerScheduled: "Schedule for a specific time",
  dashboardTaskTriggerCreateOnly: "Create only",
  dashboardTaskTriggerScheduledAt: "Execution time",
  dashboardTaskTriggerDone: "Done",
  dashboardTaskTitle: "创建一个新任务",
  dashboardTaskPromptPlaceholder: "描述任务目标、对象、约束和交付物",
  dashboardTaskAgentGroupTitle: (options) => `Agents ${options?.count ?? 0}`,
  dashboardTaskAgentsViewAll: "查看全部",
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
  HOME_ENTRY_PATH: "/tasks/new-conversation",
  TASK_ENTRY_PATH: "/tasks/new-task",
  useSelectedWorkspaceId: mockUseSelectedWorkspaceId,
  useUser: mockUseUser,
}));

vi.mock("@/hooks/useTopicSessions", () => ({
  useCreateTopicSession: mockUseCreateTopicSession,
}));

vi.mock("@/hooks/useFileUpload", () => ({
  useFileUpload: mockUseFileUpload,
}));

vi.mock("@/hooks/useSkills", () => ({
  useSkills: mockUseSkills,
}));

vi.mock("@/services/api/tasks", () => ({
  tasksApi: {
    create: mockCreateTaskRun,
  },
}));

import { HomeMainContent } from "../HomeMainContent";

function makeCompletedUpload({
  id = "upload-1",
  key = "file-key-1",
  fileName = "plan.pdf",
  fileSize = 1234,
  mimeType = "application/pdf",
} = {}) {
  return {
    id,
    file: new File(["uploaded"], fileName, { type: mimeType }),
    progress: 100,
    status: "completed" as const,
    result: {
      key,
      fileName,
      fileSize,
      mimeType,
    },
  };
}

function getStoredDashboardDrafts(): Record<string, string> {
  const drafts: Record<string, string> = {};

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.includes("dashboard")) continue;

    const value = localStorage.getItem(key);
    if (value !== null) {
      drafts[key] = value;
    }
  }

  return drafts;
}

async function selectDashboardAgent(name: RegExp) {
  fireEvent.pointerDown(screen.getByRole("button", { name: /agent/i }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name }));
}

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
    localStorage.clear();
    mockUploadState.uploadingFiles = [];

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
    mockUseSkills.mockReturnValue({
      data: [
        {
          id: "skill-1",
          tenantId: "ws-1",
          name: "Draft campaign brief",
          description: "Prepare a concise launch brief",
          type: "prompt_template",
          icon: null,
          folderId: null,
          agentAccess: "read",
          creatorId: "user-1",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "skill-2",
          tenantId: "ws-1",
          name: "Analyze metrics",
          description: "Summarize performance changes",
          type: "general",
          icon: null,
          folderId: null,
          agentAccess: "read",
          creatorId: "user-1",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
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
    mockCreateTaskRun.mockResolvedValue({
      id: "task-run-new",
    });
    mockUseCreateTopicSession.mockReturnValue({
      mutateAsync: mockCreateTopicSessionMutate,
      isPending: false,
    });
    mockUseFileUpload.mockImplementation(() => {
      const completedAttachments = mockUploadState.uploadingFiles
        .filter((file) => file.status === "completed" && file.result)
        .map((file) => ({
          fileKey: file.result.key,
          fileName: file.result.fileName,
          fileSize: file.result.fileSize,
          mimeType: file.result.mimeType,
        }));

      return {
        uploadingFiles: mockUploadState.uploadingFiles,
        addFiles: mockUploadState.addFiles,
        removeFile: mockUploadState.removeFile,
        retryFile: mockUploadState.retryFile,
        clearFiles: mockUploadState.clearFiles,
        getAttachments: vi.fn(() => completedAttachments),
        isUploading: false,
        hasErrors: false,
        allCompleted: completedAttachments.length > 0,
      };
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
    expect(screen.getByText(/deep research/i)).toBeInTheDocument();
    expect(screen.getByText(/create video/i)).toBeInTheDocument();
    const planCreditsPill = screen.getByTestId("dashboard-plan-credits-pill");
    expect(within(planCreditsPill).getByText("Starter")).toBeInTheDocument();
    expect(within(planCreditsPill).getByText("5,875")).toBeInTheDocument();
    expect(
      within(planCreditsPill).queryByRole("button", { name: "Upgrade" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /conversation mode/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /task mode/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
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
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

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

  it("attaches official-style Deep Research request metadata from the dashboard", async () => {
    renderWithProviders(<HomeMainContent />);

    const prompt = screen.getByPlaceholderText(/message dashboard/i);
    const deepResearchButton = screen.getByRole("button", {
      name: /deep research/i,
    });

    expect(deepResearchButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(deepResearchButton);
    expect(prompt).toHaveValue("");
    expect(deepResearchButton).toHaveAttribute("aria-pressed", "true");
    expect(deepResearchButton.className).toContain("bg-[#2f67ff]");
    fireEvent.click(deepResearchButton);
    expect(deepResearchButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Deep Research")).not.toBeInTheDocument();
    fireEvent.click(deepResearchButton);
    expect(deepResearchButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /max/i }));
    fireEvent.click(screen.getByRole("button", { name: /visuals on/i }));
    fireEvent.change(prompt, {
      target: { value: "Research the cloud GPU market" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    await vi.waitFor(() => {
      expect(mockCreateTopicSessionMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          botUserId: "agent-1",
          initialMessage: "Research the cloud GPU market",
          metadata: {
            deepResearchRequest: expect.objectContaining({
              source: "team9",
              kind: "request",
              agent: "deep-research-max-preview-04-2026",
              mode: "max",
              background: true,
              stream: true,
              requestPlanFirst: true,
              agentConfig: expect.objectContaining({
                type: "deep-research",
                thinkingSummaries: "auto",
                thinking_summaries: "auto",
                visualization: "off",
                collaborativePlanning: true,
                collaborative_planning: true,
              }),
              sources: {
                googleSearch: true,
                uploadedFiles: false,
              },
              tools: expect.arrayContaining([
                { type: "google_search" },
                { type: "url_context" },
                { type: "code_execution" },
              ]),
            }),
          },
        }),
      );
    });
  });

  it("ignores duplicate dashboard submits while the first topic session is in flight", async () => {
    let resolveMutation!: (value: {
      channelId: string;
      sessionId: string;
      agentId: string;
      botUserId: string;
      title: null;
      createdAt: string;
    }) => void;
    mockCreateTopicSessionMutate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        }),
    );

    renderWithProviders(<HomeMainContent />);

    fireEvent.change(screen.getByPlaceholderText(/message dashboard/i), {
      target: { value: "hello beta" },
    });

    const sendButton = screen.getByRole("button", { name: /send message/i });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    expect(mockCreateTopicSessionMutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMutation({
        channelId: "topic-ch-new",
        sessionId: "session-new",
        agentId: "agent-hive-id",
        botUserId: "bot-1",
        title: null,
        createdAt: "2024-01-01T00:00:00.000Z",
      });
    });

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/channels/$channelId",
        params: { channelId: "topic-ch-new" },
      });
    });
  });

  it("submits the dashboard prompt on Enter outside IME composition", async () => {
    renderWithProviders(<HomeMainContent />);

    fireEvent.change(screen.getByPlaceholderText(/message dashboard/i), {
      target: { value: "hello alpha" },
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText(/message dashboard/i), {
        key: "Enter",
        code: "Enter",
      });
    });

    await vi.waitFor(() => {
      expect(mockCreateTopicSessionMutate).toHaveBeenCalledWith({
        botUserId: "agent-1",
        initialMessage: "hello alpha",
        model: { provider: "openrouter", id: "openai/gpt-4.1" },
      });
    });
  });

  it("does not submit when Enter commits an IME candidate", () => {
    renderWithProviders(<HomeMainContent />);

    const input = screen.getByPlaceholderText(/message dashboard/i);
    fireEvent.compositionStart(input);
    fireEvent.change(input, {
      target: { value: "n" },
    });
    // Mirrors WKWebView/Safari ordering: compositionend can arrive before the
    // Enter keydown that commits the candidate.
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
    });

    expect(mockCreateTopicSessionMutate).not.toHaveBeenCalled();
  });

  it("keeps dashboard prompt drafts isolated per selected agent", async () => {
    renderWithProviders(<HomeMainContent />);

    const input = screen.getByPlaceholderText(/message dashboard/i);
    fireEvent.change(input, {
      target: { value: "alpha draft" },
    });

    await selectDashboardAgent(/beta agent/i);
    expect(screen.getByPlaceholderText(/message dashboard/i)).toHaveValue("");

    fireEvent.change(screen.getByPlaceholderText(/message dashboard/i), {
      target: { value: "beta draft" },
    });

    await selectDashboardAgent(/alpha agent/i);
    expect(screen.getByPlaceholderText(/message dashboard/i)).toHaveValue(
      "alpha draft",
    );

    await selectDashboardAgent(/beta agent/i);
    expect(screen.getByPlaceholderText(/message dashboard/i)).toHaveValue(
      "beta draft",
    );
  });

  it("persists completed uploads as part of the selected agent dashboard draft", async () => {
    renderWithProviders(<HomeMainContent />);

    mockUploadState.uploadingFiles = [
      makeCompletedUpload({
        key: "file-alpha",
        fileName: "alpha-plan.pdf",
        fileSize: 2048,
        mimeType: "application/pdf",
      }),
    ];
    fireEvent.change(screen.getByPlaceholderText(/message dashboard/i), {
      target: { value: "alpha with attachment" },
    });

    await vi.waitFor(() => {
      const drafts = getStoredDashboardDrafts();
      const stored = Object.values(drafts).find((value) =>
        value?.includes("file-alpha"),
      );
      expect(stored).toBeTruthy();
      expect(stored).toContain("alpha-plan.pdf");
      expect(stored).toContain("alpha with attachment");
    });

    mockUploadState.uploadingFiles = [];
    await selectDashboardAgent(/beta agent/i);
    await selectDashboardAgent(/alpha agent/i);
    expect(await screen.findByText("alpha-plan.pdf")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    await vi.waitFor(() => {
      expect(mockCreateTopicSessionMutate).toHaveBeenCalledWith({
        botUserId: "agent-1",
        initialMessage: "alpha with attachment",
        model: { provider: "openrouter", id: "openai/gpt-4.1" },
        attachments: [
          {
            fileKey: "file-alpha",
            fileName: "alpha-plan.pdf",
            fileSize: 2048,
            mimeType: "application/pdf",
          },
        ],
      });
    });
  });

  it("clears the selected agent dashboard draft after a successful send", async () => {
    renderWithProviders(<HomeMainContent />);

    mockUploadState.uploadingFiles = [
      makeCompletedUpload({
        key: "file-to-clear",
        fileName: "clear-me.pdf",
      }),
    ];
    fireEvent.change(screen.getByPlaceholderText(/message dashboard/i), {
      target: { value: "send and clear" },
    });

    await vi.waitFor(() => {
      expect(
        Object.values(getStoredDashboardDrafts()).some((value) =>
          value?.includes("file-to-clear"),
        ),
      ).toBe(true);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    await vi.waitFor(() => {
      expect(screen.getByPlaceholderText(/message dashboard/i)).toHaveValue("");
      expect(
        Object.values(getStoredDashboardDrafts()).some((value) =>
          value?.includes("send and clear"),
        ),
      ).toBe(false);
      expect(
        Object.values(getStoredDashboardDrafts()).some((value) =>
          value?.includes("file-to-clear"),
        ),
      ).toBe(false);
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

  it("keeps dashboard composer controls styled for dark mode", () => {
    renderWithProviders(<HomeMainContent />);

    expect(screen.getByRole("button", { name: /gpt-4.1/i })).toHaveClass(
      "dark:border-white/10",
      "dark:bg-white/[0.08]",
      "dark:text-[#d8d0c5]",
      "dark:hover:bg-white/[0.12]",
    );
    expect(screen.getByRole("button", { name: /send message/i })).toHaveClass(
      "dark:bg-[#726f68]",
      "dark:text-[#f6f0e8]",
      "dark:hover:bg-[#838077]",
      "dark:disabled:bg-white/[0.08]",
      "dark:disabled:text-white/30",
    );
  });

  it("keeps the dashboard model menu visually minimal", async () => {
    renderWithProviders(<HomeMainContent />);

    fireEvent.pointerDown(screen.getByRole("button", { name: /gpt-4.1/i }));

    expect(await screen.findByText("Gemini 3.1 Pro")).toBeInTheDocument();
    expect(screen.getByText("Gemini 3.5 Flash")).toBeInTheDocument();
    expect(screen.getByText("Gemini 3 Flash")).toBeInTheDocument();
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    expect(screen.queryByText("Google")).not.toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toHaveClass("w-max");
    expect(screen.getByRole("menu")).not.toHaveClass("w-[12.5rem]");

    const menu = within(screen.getByRole("menu"));
    expect(menu.getAllByRole("img", { name: "Claude logo" })).toHaveLength(2);
    expect(menu.getAllByRole("img", { name: "ChatGPT logo" })).toHaveLength(3);
    expect(menu.getAllByRole("img", { name: "Gemini logo" })).toHaveLength(3);
    expect(
      menu.getByRole("img", { name: "DeepSeek logo" }),
    ).toBeInTheDocument();
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

  it("animates mode switching in place while preserving the composer draft", () => {
    renderWithProviders(<HomeMainContent />);

    const switcher = screen.getByRole("tablist", { name: /dashboard mode/i });
    expect(
      within(switcher).getByTestId("dashboard-mode-switch-indicator"),
    ).toHaveClass("transition-transform");

    fireEvent.change(screen.getByPlaceholderText(/message dashboard/i), {
      target: { value: "keep this draft" },
    });
    fireEvent.click(screen.getByRole("tab", { name: /task mode/i }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/tasks/new-task" });
    expect(screen.getByRole("tab", { name: /task mode/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByPlaceholderText("描述任务目标、对象、约束和交付物"),
    ).toHaveValue("keep this draft");
    expect(
      within(switcher).getByTestId("dashboard-mode-switch-indicator"),
    ).toHaveClass("translate-x-[calc(100%+0.25rem)]");

    fireEvent.click(screen.getByRole("tab", { name: /conversation mode/i }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/tasks/new-conversation",
    });
    expect(screen.getByPlaceholderText(/message dashboard/i)).toHaveValue(
      "keep this draft",
    );
  });

  it("uses the task draft copy, skill selector, and hidden agent suggestions in task mode", async () => {
    renderWithProviders(<HomeMainContent mode="task" />);

    expect(
      screen.getByRole("heading", { name: "创建一个新任务" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("描述任务目标、对象、约束和交付物"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Agents 2")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /create video/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /deep research/i }),
    ).not.toBeInTheDocument();
    const skillSelector = screen.getByRole("button", {
      name: /select skills/i,
    });
    expect(skillSelector).toBeInTheDocument();
    fireEvent.pointerDown(skillSelector);
    const firstSkill = await screen.findByRole("menuitemcheckbox", {
      name: /draft campaign brief/i,
    });
    const secondSkill = screen.getByRole("menuitemcheckbox", {
      name: /analyze metrics/i,
    });
    fireEvent.click(firstSkill);
    fireEvent.click(secondSkill);
    expect(firstSkill).toHaveAttribute("aria-checked", "true");
    expect(secondSkill).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menu", { name: /2 skills selected/i }),
    ).toBeInTheDocument();
    fireEvent.keyDown(secondSkill, { key: "Escape" });
    expect(
      screen.getByRole("button", { name: /2 skills selected/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run after creation" }),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("描述任务目标、对象、约束和交付物"),
      {
        target: { value: "让 alpha 处理这个任务" },
      },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    await vi.waitFor(() => {
      expect(mockCreateTaskRun).toHaveBeenCalledWith(
        expect.objectContaining({ botId: "bot-1" }),
      );
    });
  });

  it("creates a task run from the task-mode prompt and navigates to the task", async () => {
    renderWithProviders(<HomeMainContent mode="task" />);

    fireEvent.change(
      screen.getByPlaceholderText("描述任务目标、对象、约束和交付物"),
      {
        target: { value: "找 20 位 KOC\n整理首轮触达建议" },
      },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    await vi.waitFor(() => {
      expect(mockCreateTaskRun).toHaveBeenCalledWith({
        title: "找 20 位 KOC",
        description: "找 20 位 KOC\n整理首轮触达建议",
        botId: "bot-1",
        executeImmediately: true,
        triggerMode: "immediate",
      });
    });
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/tasks/$taskId",
        params: { taskId: "task-run-new" },
      });
    });
  });

  it("creates a task run without immediate execution when create-only is selected", async () => {
    renderWithProviders(<HomeMainContent mode="task" />);

    fireEvent.click(screen.getByRole("button", { name: "Run after creation" }));
    expect(
      await screen.findByRole("dialog", { name: "Task trigger settings" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Create only"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.getByRole("button", { name: "Create only" }),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("描述任务目标、对象、约束和交付物"),
      {
        target: { value: "整理候选达人列表" },
      },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    await vi.waitFor(() => {
      expect(mockCreateTaskRun).toHaveBeenCalledWith({
        title: "整理候选达人列表",
        description: "整理候选达人列表",
        botId: "bot-1",
        executeImmediately: false,
        triggerMode: "create_only",
      });
    });
  });

  it("keeps the scheduled task trigger time in the create payload", async () => {
    renderWithProviders(<HomeMainContent mode="task" />);

    fireEvent.click(screen.getByRole("button", { name: "Run after creation" }));
    fireEvent.click(screen.getByLabelText("Schedule for a specific time"));
    fireEvent.change(screen.getByLabelText("Execution time"), {
      target: { value: "2026-05-21T10:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.getByRole("button", { name: "Schedule for a specific time" }),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("描述任务目标、对象、约束和交付物"),
      {
        target: { value: "明天上午整理候选达人列表" },
      },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    });

    await vi.waitFor(() => {
      expect(mockCreateTaskRun).toHaveBeenCalledWith({
        title: "明天上午整理候选达人列表",
        description: "明天上午整理候选达人列表",
        botId: "bot-1",
        executeImmediately: false,
        triggerMode: "scheduled",
        scheduledAt: "2026-05-21T10:30",
      });
    });
  });

  it("keeps the upgrade action in the plan capsule for free workspaces", () => {
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

    const planCreditsPill = screen.getByTestId("dashboard-plan-credits-pill");
    expect(within(planCreditsPill).getByText("Free plan")).toBeInTheDocument();
    expect(within(planCreditsPill).getByText("—")).toBeInTheDocument();
    fireEvent.click(
      within(planCreditsPill).getByRole("button", { name: "Upgrade" }),
    );

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/subscription",
      search: { view: "plans", source: "home" },
    });
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
