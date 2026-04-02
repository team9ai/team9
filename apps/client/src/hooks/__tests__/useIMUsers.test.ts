import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAppStore } from "@/stores";

const mockQueryClient = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

const mockUpdateMe = vi.hoisted(() => vi.fn());
const mockGetPendingEmailChange = vi.hoisted(() => vi.fn());
const mockStartEmailChange = vi.hoisted(() => vi.fn());
const mockResendEmailChange = vi.hoisted(() => vi.fn());
const mockCancelEmailChange = vi.hoisted(() => vi.fn());
const mockSyncCurrentUser = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());
const capturedMutationOptions = vi.hoisted(() => ({
  current: undefined as
    | {
        mutationFn?: (variables: unknown) => Promise<unknown>;
        onSuccess?: (data: unknown, variables: unknown) => void;
      }
    | undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mockQueryClient,
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (options: typeof capturedMutationOptions.current) => {
    capturedMutationOptions.current = options;
    return {
      mutateAsync: async (variables: unknown) =>
        options?.mutationFn?.(variables),
    };
  },
}));

vi.mock("@/services/api", () => ({
  default: {
    im: {
      users: {
        getOnlineUsers: vi.fn(),
        getUser: vi.fn(),
        updateStatus: vi.fn(),
        updateMe: mockUpdateMe,
        searchUsers: vi.fn(),
      },
    },
    applications: {
      getInstalledApplicationsWithBots: vi.fn(),
    },
    account: {
      getPendingEmailChange: mockGetPendingEmailChange,
      startEmailChange: mockStartEmailChange,
      resendEmailChange: mockResendEmailChange,
      cancelEmailChange: mockCancelEmailChange,
    },
  },
}));

vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: () => "workspace-1",
}));

vi.mock("../useAuth", () => ({
  syncCurrentUser: mockSyncCurrentUser,
}));

import {
  usePendingEmailChange,
  useStartEmailChange,
  useResendEmailChange,
  useCancelEmailChange,
  useUpdateCurrentUser,
  useIsUserOnline,
} from "../useIMUsers";

describe("useIMUsers hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedMutationOptions.current = undefined;
    useAppStore.getState().reset();
    mockUseQuery.mockReset();
  });

  it("loads the pending email change on the account query key", async () => {
    let capturedQueryKey: unknown;
    let capturedQueryFn: (() => Promise<unknown>) | undefined;

    mockUseQuery.mockImplementation(
      ({
        queryKey,
        queryFn,
      }: {
        queryKey?: unknown;
        queryFn?: () => Promise<unknown>;
      }) => {
        capturedQueryKey = queryKey;
        capturedQueryFn = queryFn;
        return {
          data: undefined,
          isLoading: false,
        };
      },
    );

    renderHook(() => usePendingEmailChange());

    expect(capturedQueryKey).toEqual(["account", "email-change"]);

    await capturedQueryFn?.();
    expect(mockGetPendingEmailChange).toHaveBeenCalledTimes(1);
  });

  it("updates the current user profile, syncs the user, and refreshes the user query", async () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    renderHook(() => useUpdateCurrentUser());

    const payload = {
      username: "alice",
      displayName: "Alice",
      avatarUrl: "https://cdn.example.com/avatar.png",
    };
    const updatedUser = {
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
      displayName: "Alice",
      avatarUrl: "https://cdn.example.com/avatar.png",
      status: "online",
      isActive: true,
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    await capturedMutationOptions.current?.mutationFn?.(payload);
    expect(mockUpdateMe).toHaveBeenCalledWith(payload);

    capturedMutationOptions.current?.onSuccess?.(updatedUser, payload);

    expect(mockSyncCurrentUser).toHaveBeenCalledWith(
      updatedUser,
      mockQueryClient,
    );
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["im-users", "user-1"],
    });
  });

  it("starts an email change request and refreshes pending email-change state", async () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    renderHook(() => useStartEmailChange());

    await capturedMutationOptions.current?.mutationFn?.({
      newEmail: "alice+new@example.com",
    });

    expect(mockStartEmailChange).toHaveBeenCalledWith({
      newEmail: "alice+new@example.com",
    });

    capturedMutationOptions.current?.onSuccess?.(
      { message: "Confirmation email sent." },
      { newEmail: "alice+new@example.com" },
    );

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["account", "email-change"],
    });
  });

  it("resends an email change request and refreshes pending email-change state", async () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    renderHook(() => useResendEmailChange());

    await capturedMutationOptions.current?.mutationFn?.(undefined);
    expect(mockResendEmailChange).toHaveBeenCalledWith();

    capturedMutationOptions.current?.onSuccess?.(
      { message: "Confirmation email resent." },
      undefined,
    );

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["account", "email-change"],
    });
  });

  it("cancels an email change request and refreshes pending email-change state", async () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    renderHook(() => useCancelEmailChange());

    await capturedMutationOptions.current?.mutationFn?.(undefined);
    expect(mockCancelEmailChange).toHaveBeenCalledWith();

    capturedMutationOptions.current?.onSuccess?.(
      { message: "Pending email change cancelled." },
      undefined,
    );

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["account", "email-change"],
    });
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
          isLoading: false,
        };
      }

      return { data: undefined, isLoading: false };
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
          isLoading: false,
        };
      }

      return { data: undefined, isLoading: false };
    });

    const { result } = renderHook(() => useIsUserOnline("user-openclaw"));

    expect(result.current).toBe(false);
  });
});
