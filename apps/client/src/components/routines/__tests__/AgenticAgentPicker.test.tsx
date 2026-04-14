import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledApplicationWithBots } from "@/services/api/applications";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockRouterNavigate = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockUseMutation = vi.hoisted(() =>
  vi.fn(() => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
  })),
);
const mockUseSelectedWorkspaceId = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouter: () => ({ navigate: mockRouterNavigate }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  useMutation: mockUseMutation,
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: mockUseSelectedWorkspaceId,
}));

vi.mock("@/services/api", () => ({
  api: {
    applications: {
      getInstalledApplicationsWithBots: vi.fn(),
    },
    routines: {
      createWithCreationTask: vi.fn(),
    },
  },
}));

import { AgenticAgentPicker } from "../AgenticAgentPicker";

function installedApp(
  overrides: Partial<InstalledApplicationWithBots>,
): InstalledApplicationWithBots {
  return {
    id: "app-id",
    applicationId: "common-staff",
    name: "Common Staff",
    description: "",
    tenantId: "workspace-1",
    installedBy: "user-1",
    config: {},
    permissions: {},
    status: "active",
    isActive: true,
    createdAt: "2026-04-10T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    type: "managed",
    bots: [],
    instanceStatus: null,
    ...overrides,
  } as InstalledApplicationWithBots;
}

describe("AgenticAgentPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSelectedWorkspaceId.mockReturnValue("workspace-1");
  });

  function mockCacheWithApps(apps: InstalledApplicationWithBots[]) {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === "installed-applications-with-bots") {
        return { data: apps, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });
  }

  it("derives bots from the shared Application[] cache shape", () => {
    // Regression: other consumers (useAlwaysOnlineBaseModelBotUserIds,
    // useBotModelSwitch, useDashboardAgents, etc.) share the queryKey
    // ['installed-applications-with-bots', workspaceId] and populate the
    // cache with Application[]. The picker must read that same shape and
    // flatten client-side, not re-run a conflicting queryFn that returned
    // a flat Bot[] shape.
    mockCacheWithApps([
      installedApp({
        id: "app-common",
        applicationId: "common-staff",
        bots: [
          {
            botId: "bot-common-1",
            userId: "user-common-1",
            username: "common_1",
            displayName: "Workforce Metrics Monitor",
            roleTitle: null,
            persona: null,
            jobDescription: null,
            avatarUrl: null,
            model: null,
            mentorId: null,
            mentorDisplayName: null,
            mentorAvatarUrl: null,
            isActive: true,
            createdAt: "2026-04-10T00:00:00.000Z",
            managedMeta: null,
          },
        ],
      }),
    ]);

    render(
      <AgenticAgentPicker
        open
        onClose={vi.fn()}
        onOpenCreationSession={vi.fn()}
      />,
    );

    expect(
      screen.queryByText("agentic.noAgentsAvailable"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Workforce Metrics Monitor")).toBeInTheDocument();
  });

  it("excludes openclaw bots and apps that are not active", () => {
    mockCacheWithApps([
      installedApp({
        id: "app-openclaw",
        applicationId: "openclaw",
        bots: [
          {
            botId: "bot-openclaw-1",
            userId: "user-openclaw-1",
            agentType: "openclaw",
            agentId: "agent-1",
            workspace: null,
            username: "hydra",
            displayName: "Hydra",
            isActive: true,
            createdAt: "2026-04-10T00:00:00.000Z",
            mentorId: null,
            mentorDisplayName: null,
            mentorAvatarUrl: null,
          },
        ],
      }),
      installedApp({
        id: "app-pending",
        applicationId: "common-staff",
        status: "pending",
        bots: [
          {
            botId: "bot-pending",
            userId: "user-pending",
            username: "pending",
            displayName: "Pending Bot",
            roleTitle: null,
            persona: null,
            jobDescription: null,
            avatarUrl: null,
            model: null,
            mentorId: null,
            mentorDisplayName: null,
            mentorAvatarUrl: null,
            isActive: true,
            createdAt: "2026-04-10T00:00:00.000Z",
            managedMeta: null,
          },
        ],
      }),
    ]);

    render(
      <AgenticAgentPicker
        open
        onClose={vi.fn()}
        onOpenCreationSession={vi.fn()}
      />,
    );

    expect(screen.getByText("agentic.noAgentsAvailable")).toBeInTheDocument();
    expect(screen.queryByText("Hydra")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending Bot")).not.toBeInTheDocument();
  });

  it("shows empty state when cache has no installed apps", () => {
    mockCacheWithApps([]);

    render(
      <AgenticAgentPicker
        open
        onClose={vi.fn()}
        onOpenCreationSession={vi.fn()}
      />,
    );

    expect(screen.getByText("agentic.noAgentsAvailable")).toBeInTheDocument();
  });

  it("calls onOpenCreationSession with new routine id after successful create, does not navigate", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    // Capture the mutation options so we can invoke onSuccess manually
    let capturedOptions: { onSuccess?: (data: unknown) => void } | undefined;
    mockUseMutation.mockImplementation((opts: unknown) => {
      capturedOptions = opts as typeof capturedOptions;
      return {
        mutate: () => {
          capturedOptions?.onSuccess?.({
            routineId: "new-routine",
            creationChannelId: "ch-1",
            creationSessionId: "team9/t/a/dm/ch-1",
          });
        },
        reset: vi.fn(),
        isPending: false,
      };
    });

    mockCacheWithApps([
      installedApp({
        id: "app-1",
        applicationId: "common-staff",
        bots: [
          {
            botId: "bot-1",
            userId: "u-bot-1",
            username: "bot",
            displayName: "Test Bot",
            roleTitle: null,
            persona: null,
            jobDescription: null,
            avatarUrl: null,
            model: null,
            mentorId: null,
            mentorDisplayName: null,
            mentorAvatarUrl: null,
            isActive: true,
            createdAt: "2026-04-10T00:00:00.000Z",
            managedMeta: null,
          },
        ],
      }),
    ]);

    render(
      <AgenticAgentPicker
        open
        onClose={onClose}
        onOpenCreationSession={onOpen}
      />,
    );

    // The "agentic.confirm" button triggers the mutation
    fireEvent.click(screen.getByText("agentic.confirm"));

    expect(onClose).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith("new-routine");
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockRouterNavigate).not.toHaveBeenCalled();
  });
});
