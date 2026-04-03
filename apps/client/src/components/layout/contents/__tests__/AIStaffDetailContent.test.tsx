import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledApplicationWithBots } from "@/services/api/applications";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockUseSelectedWorkspaceId = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          aiStaff: "AI Staff",
        }) as const
      )[key] ?? key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: mockUseSelectedWorkspaceId,
}));

vi.mock("../WorkspaceFileBrowserContent", () => ({
  WorkspaceFileBrowserContent: () => <div>workspace-browser</div>,
}));

import { AIStaffDetailContent } from "../AIStaffDetailContent";

describe("AIStaffDetailContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSelectedWorkspaceId.mockReturnValue("workspace-1");
  });

  it("renders base model staff details for a base-model-staff bot id", () => {
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
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
        type: "managed",
        bots: [
          {
            botId: "bot-claude-1",
            userId: "user-claude-1",
            agentType: "base_model",
            username: "claude_bot_workspace_1",
            displayName: "Claude",
            isActive: true,
            createdAt: "2026-04-04T00:00:00.000Z",
            managedMeta: {
              agentId: "base-model-claude-workspace-1",
            },
          },
        ],
        instanceStatus: null,
      },
    ];

    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      const key = queryKey[0];

      if (key === "installed-applications-with-bots") {
        return {
          data: installedApps,
          isLoading: false,
          error: null,
        };
      }

      if (key === "workspace-members") {
        return {
          data: { members: [] },
          isLoading: false,
          error: null,
        };
      }

      return {
        data: null,
        isLoading: false,
        error: null,
      };
    });

    render(<AIStaffDetailContent staffId="bot-claude-1" />);

    expect(
      screen.getByRole("img", { name: "Claude logo" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.queryByText("Bot not found")).not.toBeInTheDocument();
  });
});
