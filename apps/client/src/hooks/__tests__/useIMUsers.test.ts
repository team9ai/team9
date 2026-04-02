import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockUseQuery = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: () => "workspace-1",
}));

import { useIsUserOnline } from "../useIMUsers";

describe("useIsUserOnline", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  it("treats base-model-staff bots as online by default", () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === "im-users" && queryKey[1] === "online") {
        return { data: {} };
      }

      if (
        queryKey[0] === "installed-applications-with-bots" &&
        queryKey[1] === "workspace-1"
      ) {
        return {
          data: [
            {
              id: "app-base",
              applicationId: "base-model-staff",
              bots: [
                {
                  botId: "bot-base",
                  userId: "user-base",
                  username: "claude_bot_workspace",
                  displayName: "Claude",
                  isActive: true,
                  createdAt: "2026-04-02T00:00:00Z",
                  managedMeta: { agentId: "base-model-claude-workspace-1" },
                },
              ],
            },
          ],
        };
      }

      return { data: undefined };
    });

    const { result } = renderHook(() => useIsUserOnline("user-base"));

    expect(result.current).toBe(true);
  });

  it("does not force non-base-model bots online", () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === "im-users" && queryKey[1] === "online") {
        return { data: {} };
      }

      if (
        queryKey[0] === "installed-applications-with-bots" &&
        queryKey[1] === "workspace-1"
      ) {
        return {
          data: [
            {
              id: "app-openclaw",
              applicationId: "openclaw",
              bots: [
                {
                  botId: "bot-openclaw",
                  userId: "user-openclaw",
                  agentId: "agent-openclaw-1",
                  workspace: "default",
                  username: "hydra",
                  displayName: "Hydra",
                  isActive: true,
                  createdAt: "2026-04-02T00:00:00Z",
                  mentorId: null,
                  mentorDisplayName: null,
                  mentorAvatarUrl: null,
                },
              ],
            },
          ],
        };
      }

      return { data: undefined };
    });

    const { result } = renderHook(() => useIsUserOnline("user-openclaw"));

    expect(result.current).toBe(false);
  });
});
