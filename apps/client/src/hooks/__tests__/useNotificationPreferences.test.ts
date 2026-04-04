import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

// --- Hoisted mocks ---
const mockGetPreferences = vi.hoisted(() => vi.fn());
const mockUpdatePreferences = vi.hoisted(() => vi.fn());

vi.mock("@/services/api/notification-preferences", () => ({
  getPreferences: mockGetPreferences,
  updatePreferences: mockUpdatePreferences,
}));

import { useNotificationPreferences } from "../useNotificationPreferences";

const defaultPreferences = {
  mentionsEnabled: true,
  repliesEnabled: true,
  dmsEnabled: true,
  systemEnabled: true,
  workspaceEnabled: true,
  desktopEnabled: false,
  soundEnabled: true,
  dndEnabled: false,
  dndStart: null,
  dndEnd: null,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe("useNotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPreferences.mockResolvedValue(defaultPreferences);
    mockUpdatePreferences.mockImplementation(async (dto) => ({
      ...defaultPreferences,
      ...dto,
    }));
  });

  it("fetches preferences on mount", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.preferences).toEqual(defaultPreferences);
    expect(mockGetPreferences).toHaveBeenCalledTimes(1);
  });

  it("returns undefined preferences while loading", () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.preferences).toBeUndefined();
  });

  it("updates preferences with optimistic update", async () => {
    const updatedPrefs = { ...defaultPreferences, soundEnabled: false };
    // After mutation succeeds, the refetch should return updated data
    mockUpdatePreferences.mockResolvedValueOnce(updatedPrefs);
    mockGetPreferences
      .mockResolvedValueOnce(defaultPreferences)
      .mockResolvedValue(updatedPrefs);

    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Perform update
    await act(async () => {
      await result.current.updatePreferences({ soundEnabled: false });
    });

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      soundEnabled: false,
    });

    // After settlement, the cache should be invalidated and refetched
    await waitFor(() => {
      expect(result.current.preferences?.soundEnabled).toBe(false);
    });
  });

  it("rolls back optimistic update on error", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Make the mutation fail
    mockUpdatePreferences.mockRejectedValueOnce(new Error("Network error"));
    // The refetch after rollback should return original data
    mockGetPreferences.mockResolvedValue(defaultPreferences);

    await act(async () => {
      try {
        await result.current.updatePreferences({ soundEnabled: false });
      } catch {
        // Expected to throw
      }
    });

    // After error and rollback, should return to original
    await waitFor(() => {
      expect(result.current.preferences?.soundEnabled).toBe(true);
    });
  });

  it("exposes isUpdating status during mutation", async () => {
    const { wrapper } = createWrapper();

    // Make mutation take longer
    let resolveMutation!: (value: unknown) => void;
    mockUpdatePreferences.mockReturnValue(
      new Promise((resolve) => {
        resolveMutation = resolve;
      }),
    );

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isUpdating).toBe(false);

    // Start update but don't await
    let updatePromise: Promise<unknown>;
    act(() => {
      updatePromise = result.current.updatePreferences({
        dndEnabled: true,
      });
    });

    await waitFor(() => {
      expect(result.current.isUpdating).toBe(true);
    });

    // Resolve the mutation
    await act(async () => {
      resolveMutation({ ...defaultPreferences, dndEnabled: true });
      await updatePromise;
    });

    await waitFor(() => {
      expect(result.current.isUpdating).toBe(false);
    });
  });

  it("applies optimistic update immediately to cache", async () => {
    const { wrapper } = createWrapper();

    // Make mutation take longer so we can check intermediate state
    let resolveMutation!: (value: unknown) => void;
    mockUpdatePreferences.mockReturnValue(
      new Promise((resolve) => {
        resolveMutation = resolve;
      }),
    );

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Start update
    let updatePromise: Promise<unknown>;
    act(() => {
      updatePromise = result.current.updatePreferences({
        mentionsEnabled: false,
      });
    });

    // The optimistic update should be applied immediately
    await waitFor(() => {
      expect(result.current.preferences?.mentionsEnabled).toBe(false);
    });

    // Resolve the mutation
    await act(async () => {
      resolveMutation({ ...defaultPreferences, mentionsEnabled: false });
      await updatePromise;
    });
  });
});
