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
const capturedQueryOptions = vi.hoisted(() => ({
  current: undefined as
    | {
        queryKey?: unknown;
        queryFn?: () => Promise<unknown>;
      }
    | undefined,
}));
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
  useQuery: (options: typeof capturedQueryOptions.current) => {
    capturedQueryOptions.current = options;
    return {
      data: undefined,
      isLoading: false,
    };
  },
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
        updateMe: mockUpdateMe,
      },
    },
    account: {
      getPendingEmailChange: mockGetPendingEmailChange,
      startEmailChange: mockStartEmailChange,
      resendEmailChange: mockResendEmailChange,
      cancelEmailChange: mockCancelEmailChange,
    },
  },
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
} from "../useIMUsers";

describe("account hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedQueryOptions.current = undefined;
    capturedMutationOptions.current = undefined;
    useAppStore.getState().reset();
  });

  it("loads the pending email change on the account query key", async () => {
    renderHook(() => usePendingEmailChange());

    expect(capturedQueryOptions.current?.queryKey).toEqual([
      "account",
      "email-change",
    ]);

    await capturedQueryOptions.current?.queryFn?.();
    expect(mockGetPendingEmailChange).toHaveBeenCalledTimes(1);
  });

  it("updates the current user profile, syncs the user, and refreshes the user query", async () => {
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
});
