import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { InfiniteData } from "@tanstack/react-query";
import type { Message, PaginatedMessagesResponse } from "@/types/im";

// ---------- mocks ----------

const mockPinMessage = vi.fn();
const mockUnpinMessage = vi.fn();

vi.mock("@/services/api/im", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api/im")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      messages: {
        ...actual.default.messages,
        pinMessage: (...args: unknown[]) => mockPinMessage(...args),
        unpinMessage: (...args: unknown[]) => mockUnpinMessage(...args),
      },
    },
  };
});

// ---------- import after mocks ----------

import { usePinMessage, useUnpinMessage } from "../useMessages";

// ---------- helpers ----------

const CHANNEL_ID = "ch-test";
const MESSAGE_ID = "msg-test";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: MESSAGE_ID,
    channelId: CHANNEL_ID,
    senderId: "user-1",
    content: "Hello",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeQueryData(
  message: Message,
): InfiniteData<PaginatedMessagesResponse> {
  return {
    pages: [
      {
        messages: [message],
        hasOlder: false,
        hasNewer: false,
      },
    ],
    pageParams: [undefined],
  };
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

// ---------- tests ----------

describe("usePinMessage", () => {
  it("optimistically sets isPinned: true in cache before API resolves", async () => {
    // Pause the API call so we can inspect the optimistic state before it settles
    let resolvePin: () => void;
    mockPinMessage.mockReturnValue(
      new Promise<void>((res) => {
        resolvePin = res;
      }),
    );
    const queryClient = createQueryClient();
    const message = makeMessage({ isPinned: false });
    queryClient.setQueryData(["messages", CHANNEL_ID], makeQueryData(message));

    const { result } = renderHook(() => usePinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate(MESSAGE_ID);
    });

    // Wait for onMutate to run (it's async due to cancelQueries)
    await waitFor(() => {
      const cached = queryClient.getQueryData<
        InfiniteData<PaginatedMessagesResponse>
      >(["messages", CHANNEL_ID]);
      expect(cached?.pages[0].messages[0].isPinned).toBe(true);
    });

    resolvePin!();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPinMessage).toHaveBeenCalledWith(MESSAGE_ID);
  });

  it("does not modify other messages in cache", async () => {
    let resolvePin: () => void;
    mockPinMessage.mockReturnValue(
      new Promise<void>((res) => {
        resolvePin = res;
      }),
    );
    const queryClient = createQueryClient();

    const msg1 = makeMessage({ id: "msg-1", isPinned: false });
    const msg2: Message = { ...makeMessage(), id: "msg-2", isPinned: false };
    queryClient.setQueryData(["messages", CHANNEL_ID], {
      pages: [{ messages: [msg1, msg2], total: 2, hasMore: false }],
      pageParams: [undefined],
    });

    const { result } = renderHook(() => usePinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate("msg-1");
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<
        InfiniteData<PaginatedMessagesResponse>
      >(["messages", CHANNEL_ID]);
      expect(cached?.pages[0].messages[0].isPinned).toBe(true);
    });

    const cached = queryClient.getQueryData<
      InfiniteData<PaginatedMessagesResponse>
    >(["messages", CHANNEL_ID]);
    expect(cached?.pages[0].messages[1].isPinned).toBe(false);

    resolvePin!();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back optimistic update on API error", async () => {
    let rejectPin!: (err: Error) => void;
    mockPinMessage.mockReturnValue(
      new Promise<void>((_, rej) => {
        rejectPin = rej;
      }),
    );
    const queryClient = createQueryClient();
    const message = makeMessage({ isPinned: false });
    queryClient.setQueryData(["messages", CHANNEL_ID], makeQueryData(message));

    const { result } = renderHook(() => usePinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate(MESSAGE_ID);
    });

    // Wait for onMutate to apply optimistic update
    await waitFor(() => {
      const optimistic = queryClient.getQueryData<
        InfiniteData<PaginatedMessagesResponse>
      >(["messages", CHANNEL_ID]);
      expect(optimistic?.pages[0].messages[0].isPinned).toBe(true);
    });

    // Now reject the API call to trigger rollback
    act(() => {
      rejectPin(new Error("Network error"));
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Rolled back to original
    const rolledBack = queryClient.getQueryData<
      InfiniteData<PaginatedMessagesResponse>
    >(["messages", CHANNEL_ID]);
    expect(rolledBack?.pages[0].messages[0].isPinned).toBe(false);
  });

  it("invalidates queries on settled (success)", async () => {
    mockPinMessage.mockResolvedValue(undefined);
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      ["messages", CHANNEL_ID],
      makeQueryData(makeMessage()),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate(MESSAGE_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["messages", CHANNEL_ID],
    });
  });

  it("invalidates queries on settled (error)", async () => {
    mockPinMessage.mockRejectedValue(new Error("fail"));
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      ["messages", CHANNEL_ID],
      makeQueryData(makeMessage()),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate(MESSAGE_ID);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["messages", CHANNEL_ID],
    });
  });

  it("does nothing if cache is empty", async () => {
    mockPinMessage.mockResolvedValue(undefined);
    const queryClient = createQueryClient();
    // No cache seeded

    const { result } = renderHook(() => usePinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(MESSAGE_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // No crash — just the API call
    expect(mockPinMessage).toHaveBeenCalledWith(MESSAGE_ID);
  });
});

describe("useUnpinMessage", () => {
  it("optimistically sets isPinned: false in cache before API resolves", async () => {
    let resolveUnpin: () => void;
    mockUnpinMessage.mockReturnValue(
      new Promise<void>((res) => {
        resolveUnpin = res;
      }),
    );
    const queryClient = createQueryClient();
    const message = makeMessage({ isPinned: true });
    queryClient.setQueryData(["messages", CHANNEL_ID], makeQueryData(message));

    const { result } = renderHook(() => useUnpinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate(MESSAGE_ID);
    });

    // Wait for onMutate to apply optimistic update
    await waitFor(() => {
      const cached = queryClient.getQueryData<
        InfiniteData<PaginatedMessagesResponse>
      >(["messages", CHANNEL_ID]);
      expect(cached?.pages[0].messages[0].isPinned).toBe(false);
    });

    resolveUnpin!();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUnpinMessage).toHaveBeenCalledWith(MESSAGE_ID);
  });

  it("rolls back optimistic update on API error", async () => {
    let rejectUnpin!: (err: Error) => void;
    mockUnpinMessage.mockReturnValue(
      new Promise<void>((_, rej) => {
        rejectUnpin = rej;
      }),
    );
    const queryClient = createQueryClient();
    const message = makeMessage({ isPinned: true });
    queryClient.setQueryData(["messages", CHANNEL_ID], makeQueryData(message));

    const { result } = renderHook(() => useUnpinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate(MESSAGE_ID);
    });

    // Wait for onMutate to apply optimistic update
    await waitFor(() => {
      const optimistic = queryClient.getQueryData<
        InfiniteData<PaginatedMessagesResponse>
      >(["messages", CHANNEL_ID]);
      expect(optimistic?.pages[0].messages[0].isPinned).toBe(false);
    });

    // Now reject the API call to trigger rollback
    act(() => {
      rejectUnpin(new Error("Network error"));
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Rolled back to true
    const rolledBack = queryClient.getQueryData<
      InfiniteData<PaginatedMessagesResponse>
    >(["messages", CHANNEL_ID]);
    expect(rolledBack?.pages[0].messages[0].isPinned).toBe(true);
  });

  it("does not modify other messages in cache", async () => {
    let resolveUnpin: () => void;
    mockUnpinMessage.mockReturnValue(
      new Promise<void>((res) => {
        resolveUnpin = res;
      }),
    );
    const queryClient = createQueryClient();

    const msg1: Message = { ...makeMessage(), id: "msg-1", isPinned: true };
    const msg2: Message = { ...makeMessage(), id: "msg-2", isPinned: true };
    queryClient.setQueryData(["messages", CHANNEL_ID], {
      pages: [{ messages: [msg1, msg2], total: 2, hasMore: false }],
      pageParams: [undefined],
    });

    const { result } = renderHook(() => useUnpinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate("msg-1");
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<
        InfiniteData<PaginatedMessagesResponse>
      >(["messages", CHANNEL_ID]);
      expect(cached?.pages[0].messages[0].isPinned).toBe(false);
    });

    const cached = queryClient.getQueryData<
      InfiniteData<PaginatedMessagesResponse>
    >(["messages", CHANNEL_ID]);
    expect(cached?.pages[0].messages[1].isPinned).toBe(true);

    resolveUnpin!();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("invalidates queries on settled (success)", async () => {
    mockUnpinMessage.mockResolvedValue(undefined);
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      ["messages", CHANNEL_ID],
      makeQueryData(makeMessage({ isPinned: true })),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUnpinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate(MESSAGE_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["messages", CHANNEL_ID],
    });
  });

  it("invalidates queries on settled (error)", async () => {
    mockUnpinMessage.mockRejectedValue(new Error("fail"));
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      ["messages", CHANNEL_ID],
      makeQueryData(makeMessage({ isPinned: true })),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUnpinMessage(CHANNEL_ID), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate(MESSAGE_ID);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["messages", CHANNEL_ID],
    });
  });
});
