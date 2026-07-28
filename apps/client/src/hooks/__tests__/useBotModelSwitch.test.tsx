import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { InstalledApplicationWithBots } from "@/services/api/applications";

const mockGetInstalled = vi.hoisted(() => vi.fn());
const mockGetCatalog = vi.hoisted(() => vi.fn());
const mockUpdateBotModel = vi.hoisted(() => vi.fn());
const mockGetAttempt = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({
  api: {
    applications: {
      getInstalledApplicationsWithBots: mockGetInstalled,
      getStaffModelCatalog: mockGetCatalog,
    },
    im: {
      bots: { updateModel: mockUpdateBotModel },
      modelChanges: { getAttempt: mockGetAttempt },
    },
  },
}));

const mockUseWorkspaceId = vi.hoisted(() => vi.fn());
vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: mockUseWorkspaceId,
}));

import { useBotModelSwitch } from "../useBotModelSwitch";

function makeApp(
  overrides: Partial<InstalledApplicationWithBots>,
): InstalledApplicationWithBots {
  return {
    id: "app-1",
    applicationId: "base-model-staff",
    name: "Base Model Staff",
    description: "",
    tenantId: "tenant-1",
    config: {},
    permissions: {},
    status: "active",
    isActive: true,
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
    bots: [],
    instanceStatus: null,
    ...overrides,
  };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe("useBotModelSwitch · agentModelFamily", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspaceId.mockReturnValue("workspace-1");
    mockGetCatalog.mockResolvedValue({
      catalogVersion: "2026-07-16.1",
      runtimeReady: true,
      models: [
        {
          provider: "openrouter",
          id: "anthropic/claude-sonnet-4.6",
          displayKey: "staff-model.anthropic/claude-sonnet-4.6",
          label: "Claude Sonnet 4.6",
          family: "anthropic",
          enabled: true,
          capabilities: ["staff"],
          minimumResolverCapabilityVersion: "1.0.0",
          default: true,
        },
        {
          provider: "openrouter",
          id: "openai/gpt-5.4",
          displayKey: "staff-model.openai/gpt-5.4",
          label: "GPT-5.4",
          family: "openai",
          enabled: true,
          capabilities: ["staff"],
          minimumResolverCapabilityVersion: "1.0.0",
        },
        {
          provider: "openrouter",
          id: "anthropic/claude-opus-4.7",
          displayKey: "staff-model.anthropic/claude-opus-4.7",
          label: "Claude Opus 4.7",
          family: "anthropic",
          enabled: true,
          capabilities: ["staff"],
          minimumResolverCapabilityVersion: "1.0.0",
        },
      ],
    });
  });

  it.each([
    ["claude", "anthropic", "base-model-claude-tenant-1"],
    ["chatgpt", "openai", "base-model-chatgpt-tenant-1"],
    ["gemini", "google", "base-model-gemini-tenant-1"],
  ] as const)(
    "returns family %s → %s for base-model preset",
    async (_key, expectedFamily, agentId) => {
      mockGetInstalled.mockResolvedValue([
        makeApp({
          applicationId: "base-model-staff",
          bots: [
            {
              botId: "bot-1",
              userId: "bot-user-1",
              agentType: "base_model",
              username: `${_key}_bot`,
              displayName: _key,
              isActive: true,
              createdAt: "2026-04-07T00:00:00.000Z",
              managedMeta: { agentId },
            },
          ],
        }),
      ]);

      const { result } = renderHook(() => useBotModelSwitch("bot-user-1"), {
        wrapper: makeWrapper(),
      });

      await waitFor(() =>
        expect(result.current.agentModelFamily).toBe(expectedFamily),
      );
      // Fixed base-model bots stay read-only even when the runtime is ready.
      expect(result.current.canSwitchModel).toBe(false);
    },
  );

  it("returns null family for common-staff bots so the picker shows all models", async () => {
    mockGetInstalled.mockResolvedValue([
      makeApp({
        applicationId: "common-staff",
        bots: [
          {
            botId: "bot-common",
            userId: "bot-user-common",
            username: "common_bot",
            displayName: "Common",
            roleTitle: null,
            persona: null,
            jobDescription: null,
            avatarUrl: null,
            model: { provider: "openrouter", id: "openai/gpt-5.4" },
            mentorId: null,
            mentorDisplayName: null,
            mentorAvatarUrl: null,
            isActive: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            managedMeta: { agentId: "common-staff-agent-xyz" },
          },
        ],
      }),
    ]);

    const { result } = renderHook(() => useBotModelSwitch("bot-user-common"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.canSwitchModel).toBe(true));
    expect(result.current.agentModelFamily).toBeNull();
  });

  it("returns null family for personal-staff bots", async () => {
    mockGetInstalled.mockResolvedValue([
      makeApp({
        applicationId: "personal-staff",
        bots: [
          {
            botId: "bot-personal",
            userId: "bot-user-personal",
            username: "personal_bot",
            displayName: "Personal",
            avatarUrl: null,
            ownerId: "owner-1",
            persona: null,
            model: { provider: "openrouter", id: "anthropic/claude-opus-4.7" },
            visibility: { allowMention: true, allowDirectMessage: true },
            isActive: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            managedMeta: { agentId: "personal-staff-agent-abc" },
          },
        ],
      }),
    ]);

    const { result } = renderHook(
      () => useBotModelSwitch("bot-user-personal"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.canSwitchModel).toBe(true));
    expect(result.current.agentModelFamily).toBeNull();
  });

  it("disables common-staff switching when the runtime is not ready", async () => {
    mockGetCatalog.mockResolvedValue({
      catalogVersion: "2026-07-16.1",
      runtimeReady: false,
      models: [
        {
          provider: "openrouter",
          id: "anthropic/claude-sonnet-4.6",
          displayKey: "staff-model.anthropic/claude-sonnet-4.6",
          label: "Claude Sonnet 4.6",
          family: "anthropic",
          enabled: true,
          capabilities: ["staff"],
          minimumResolverCapabilityVersion: "1.0.0",
          default: true,
        },
      ],
    });
    mockGetInstalled.mockResolvedValue([
      makeApp({
        applicationId: "common-staff",
        bots: [
          {
            botId: "bot-common",
            userId: "bot-user-common",
            username: "common_bot",
            displayName: "Common",
            roleTitle: null,
            persona: null,
            jobDescription: null,
            avatarUrl: null,
            model: {
              provider: "openrouter",
              id: "anthropic/claude-sonnet-4.6",
            },
            mentorId: null,
            mentorDisplayName: null,
            mentorAvatarUrl: null,
            isActive: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            managedMeta: { agentId: "common-staff-agent-xyz" },
          },
        ],
      }),
    ]);

    const { result } = renderHook(() => useBotModelSwitch("bot-user-common"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.applicationId).toBe("common-staff");
      expect(result.current.models).toHaveLength(1);
    });
    expect(result.current.runtimeReady).toBe(false);
    expect(result.current.canSwitchModel).toBe(false);
  });

  it("returns null family when base-model agentId does not match any known preset", async () => {
    mockGetInstalled.mockResolvedValue([
      makeApp({
        applicationId: "base-model-staff",
        bots: [
          {
            botId: "bot-mystery",
            userId: "bot-user-mystery",
            agentType: "base_model",
            username: "mystery_bot",
            displayName: "Mystery",
            isActive: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            managedMeta: { agentId: "base-model-unknown-provider-tenant-1" },
          },
        ],
      }),
    ]);

    const { result } = renderHook(() => useBotModelSwitch("bot-user-mystery"), {
      wrapper: makeWrapper(),
    });

    // Wait until the query has resolved and been consumed by the hook.
    await waitFor(() =>
      expect(result.current.applicationId).toBe("base-model-staff"),
    );
    expect(result.current.agentModelFamily).toBeNull();
  });

  it("returns null family when base-model bot has no managedMeta", async () => {
    mockGetInstalled.mockResolvedValue([
      makeApp({
        applicationId: "base-model-staff",
        bots: [
          {
            botId: "bot-nometa",
            userId: "bot-user-nometa",
            agentType: "base_model",
            username: "nometa_bot",
            displayName: "Nometa",
            isActive: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            managedMeta: null,
          },
        ],
      }),
    ]);

    const { result } = renderHook(() => useBotModelSwitch("bot-user-nometa"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(result.current.applicationId).toBe("base-model-staff"),
    );
    expect(result.current.agentModelFamily).toBeNull();
  });

  it("returns null family when botUserId is null (no bot context)", () => {
    mockGetInstalled.mockResolvedValue([]);

    const { result } = renderHook(() => useBotModelSwitch(null), {
      wrapper: makeWrapper(),
    });

    expect(result.current.agentModelFamily).toBeNull();
    expect(result.current.canSwitchModel).toBe(false);
  });

  it("returns null family when the bot is not found in any installed app", async () => {
    mockGetInstalled.mockResolvedValue([
      makeApp({
        applicationId: "base-model-staff",
        bots: [
          {
            botId: "bot-other",
            userId: "bot-user-other",
            agentType: "base_model",
            username: "claude_bot",
            displayName: "Claude",
            isActive: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            managedMeta: { agentId: "base-model-claude-tenant-1" },
          },
        ],
      }),
    ]);

    const { result } = renderHook(() => useBotModelSwitch("bot-user-missing"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(mockGetInstalled).toHaveBeenCalledTimes(1));
    expect(result.current.agentModelFamily).toBeNull();
    expect(result.current.currentModel).toBeNull();
  });
});
