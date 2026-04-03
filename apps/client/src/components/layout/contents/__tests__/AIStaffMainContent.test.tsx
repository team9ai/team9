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
          createFirstAIStaff: "Create Your First AI Staff",
          aiStaffDescription: "Create AI staff members for your workspace.",
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

import { AIStaffMainContent } from "../AIStaffMainContent";

describe("AIStaffMainContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSelectedWorkspaceId.mockReturnValue("workspace-1");
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
});
