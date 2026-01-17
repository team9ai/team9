import { useCallback, useMemo } from "react";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

/**
 * Thread Scroll State Machine (Multi-instance version)
 *
 * Supports multiple concurrent thread panels, each with independent state.
 * State is keyed by messageId (root message of each thread).
 *
 * States:
 * - initializing: Thread just opened, waiting for first scroll position confirmation
 * - idle: User is at bottom, no pending new messages, ready for real-time updates
 * - browsing: User has scrolled away from bottom, browsing history
 * - hasNewMessages: New messages arrived while user was not at bottom
 * - loadingMore: Loading more historical messages (infinite scroll)
 * - jumpingToLatest: User triggered jump to latest, loading all pages and refreshing
 *
 * State Transitions:
 *
 *   ┌──────────────┐
 *   │ initializing │ ─── SCROLL_TO_BOTTOM ───► idle
 *   └──────────────┘
 *         │
 *         │ NEW_MESSAGE
 *         ▼
 *   ┌────────────────┐
 *   │ hasNewMessages │
 *   └────────────────┘
 *
 *   ┌──────┐  SCROLL_AWAY   ┌──────────┐
 *   │ idle │ ────────────►  │ browsing │
 *   └──────┘                └──────────┘
 *      ▲                         │
 *      │                         │ NEW_MESSAGE
 *      │                         ▼
 *      │   SCROLL_TO_BOTTOM ┌────────────────┐
 *      │   (no new msgs)    │ hasNewMessages │
 *      │ ◄──────────────────└────────────────┘
 *      │                         │
 *      │                         │ SCROLL_TO_BOTTOM (with new msgs)
 *      │                         │ or JUMP_TO_LATEST
 *      │                         ▼
 *      │   REFRESH_COMPLETE ┌──────────────────┐
 *      │ ◄──────────────────│ jumpingToLatest  │
 *      │                    └──────────────────┘
 *      │
 *      │   LOAD_COMPLETE    ┌─────────────┐
 *      │ ◄──────────────────│ loadingMore │
 *                           └─────────────┘
 *                                ▲
 *                                │ LOAD_MORE
 *                                │
 *            (from any state except jumpingToLatest)
 */

// State types
export type ThreadScrollState =
  | "initializing"
  | "idle"
  | "browsing"
  | "hasNewMessages"
  | "loadingMore"
  | "jumpingToLatest";

// Event types
export type ThreadScrollEvent =
  | { type: "SCROLL_TO_BOTTOM" }
  | { type: "SCROLL_AWAY" }
  | { type: "NEW_MESSAGE" }
  | { type: "LOAD_MORE" }
  | { type: "LOAD_COMPLETE" }
  | { type: "JUMP_TO_LATEST" }
  | { type: "REFRESH_COMPLETE" }
  | { type: "RESET" };

// Context data associated with the state
interface ThreadScrollContext {
  newMessageCount: number;
  hasMorePages: boolean;
}

// Individual thread state
interface ThreadStateData {
  state: ThreadScrollState;
  context: ThreadScrollContext;
}

// Default state for new threads
const getDefaultThreadState = (): ThreadStateData => ({
  state: "initializing",
  context: {
    newMessageCount: 0,
    hasMorePages: false,
  },
});

interface ThreadScrollStore {
  // Map of messageId -> thread state
  threads: Record<string, ThreadStateData>;

  // Send event to trigger state transition for a specific thread
  send: (messageId: string, event: ThreadScrollEvent) => void;

  // Get state for a specific thread (returns default if not exists)
  getThreadState: (messageId: string) => ThreadStateData;

  // Update context without changing state
  setHasMorePages: (messageId: string, hasMore: boolean) => void;

  // Reset a specific thread's state
  reset: (messageId: string) => void;

  // Remove a thread's state (cleanup when thread closes)
  remove: (messageId: string) => void;

  // Computed selectors for a specific thread
  shouldShowIndicator: (messageId: string) => boolean;
  isLoading: (messageId: string) => boolean;
}

// State transition function (pure function)
function transition(
  currentState: ThreadScrollState,
  event: ThreadScrollEvent,
  context: ThreadScrollContext,
): { state: ThreadScrollState; context: ThreadScrollContext } {
  switch (currentState) {
    case "initializing":
      switch (event.type) {
        case "SCROLL_TO_BOTTOM":
          // User confirmed at bottom, transition to idle
          return { state: "idle", context };
        case "SCROLL_AWAY":
          // User scrolled away before confirming bottom
          return { state: "browsing", context };
        case "NEW_MESSAGE":
          // New message arrived before user confirmed position
          // Show indicator since we don't know if user is at bottom
          return {
            state: "hasNewMessages",
            context: {
              ...context,
              newMessageCount: context.newMessageCount + 1,
            },
          };
        case "LOAD_MORE":
          return { state: "loadingMore", context };
        case "RESET":
          return {
            state: "initializing",
            context: { newMessageCount: 0, hasMorePages: false },
          };
        default:
          return { state: currentState, context };
      }

    case "idle":
      switch (event.type) {
        case "SCROLL_AWAY":
          return { state: "browsing", context };
        case "NEW_MESSAGE":
          // In idle state (confirmed at bottom), new messages are handled by React Query auto-refresh
          // No state change needed
          return { state: "idle", context };
        case "LOAD_MORE":
          return { state: "loadingMore", context };
        case "RESET":
          return {
            state: "initializing",
            context: { newMessageCount: 0, hasMorePages: false },
          };
        default:
          return { state: currentState, context };
      }

    case "browsing":
      switch (event.type) {
        case "SCROLL_TO_BOTTOM":
          // If no more pages and no new messages, go to idle
          if (!context.hasMorePages && context.newMessageCount === 0) {
            return { state: "idle", context };
          }
          // If has more pages, stay in browsing to continue loading
          if (context.hasMorePages) {
            return { state: "browsing", context };
          }
          // If has new messages but no more pages, need to refresh
          return { state: "jumpingToLatest", context };
        case "NEW_MESSAGE":
          return {
            state: "hasNewMessages",
            context: {
              ...context,
              newMessageCount: context.newMessageCount + 1,
            },
          };
        case "LOAD_MORE":
          return { state: "loadingMore", context };
        case "RESET":
          return {
            state: "initializing",
            context: { newMessageCount: 0, hasMorePages: false },
          };
        default:
          return { state: currentState, context };
      }

    case "hasNewMessages":
      switch (event.type) {
        case "SCROLL_TO_BOTTOM":
          // User scrolled to bottom while having new messages
          // Need to refresh to get latest
          if (!context.hasMorePages) {
            return { state: "jumpingToLatest", context };
          }
          // If still has more pages, stay in hasNewMessages
          return { state: currentState, context };
        case "NEW_MESSAGE":
          return {
            state: "hasNewMessages",
            context: {
              ...context,
              newMessageCount: context.newMessageCount + 1,
            },
          };
        case "JUMP_TO_LATEST":
          return { state: "jumpingToLatest", context };
        case "LOAD_MORE":
          return { state: "loadingMore", context };
        case "SCROLL_AWAY":
          // Already not at bottom, stay in hasNewMessages
          return { state: currentState, context };
        case "RESET":
          return {
            state: "initializing",
            context: { newMessageCount: 0, hasMorePages: false },
          };
        default:
          return { state: currentState, context };
      }

    case "loadingMore":
      switch (event.type) {
        case "LOAD_COMPLETE":
          // After loading, determine next state based on context
          if (context.newMessageCount > 0) {
            return { state: "hasNewMessages", context };
          }
          // Check if user is at bottom (this will be set by scroll handler)
          // For now, go back to browsing and let scroll handler decide
          return { state: "browsing", context };
        case "NEW_MESSAGE":
          // Accumulate new messages while loading
          return {
            state: "loadingMore",
            context: {
              ...context,
              newMessageCount: context.newMessageCount + 1,
            },
          };
        case "RESET":
          return {
            state: "initializing",
            context: { newMessageCount: 0, hasMorePages: false },
          };
        default:
          return { state: currentState, context };
      }

    case "jumpingToLatest":
      switch (event.type) {
        case "REFRESH_COMPLETE":
          return { state: "idle", context: { ...context, newMessageCount: 0 } };
        case "NEW_MESSAGE":
          // Ignore new messages during refresh, they'll be included in the refresh result
          return { state: currentState, context };
        case "RESET":
          return {
            state: "initializing",
            context: { newMessageCount: 0, hasMorePages: false },
          };
        default:
          return { state: currentState, context };
      }

    default:
      return { state: currentState, context };
  }
}

export const useThreadScrollState = create<ThreadScrollStore>()(
  subscribeWithSelector((set, get) => ({
    threads: {},

    getThreadState: (messageId: string): ThreadStateData => {
      const { threads } = get();
      return threads[messageId] || getDefaultThreadState();
    },

    send: (messageId: string, event: ThreadScrollEvent) => {
      const { threads } = get();
      const currentThreadState = threads[messageId] || getDefaultThreadState();
      const result = transition(
        currentThreadState.state,
        event,
        currentThreadState.context,
      );

      // Only update if state or context changed
      if (
        result.state !== currentThreadState.state ||
        result.context !== currentThreadState.context
      ) {
        set({
          threads: {
            ...threads,
            [messageId]: result,
          },
        });
      }
    },

    setHasMorePages: (messageId: string, hasMore: boolean) => {
      const { threads } = get();
      const currentThreadState = threads[messageId] || getDefaultThreadState();
      set({
        threads: {
          ...threads,
          [messageId]: {
            ...currentThreadState,
            context: { ...currentThreadState.context, hasMorePages: hasMore },
          },
        },
      });
    },

    reset: (messageId: string) => {
      const { threads } = get();
      set({
        threads: {
          ...threads,
          [messageId]: getDefaultThreadState(),
        },
      });
    },

    remove: (messageId: string) => {
      const { threads } = get();
      const newThreads = { ...threads };
      delete newThreads[messageId];
      set({ threads: newThreads });
    },

    shouldShowIndicator: (messageId: string) => {
      const threadState = get().getThreadState(messageId);
      return (
        threadState.state === "hasNewMessages" &&
        threadState.context.newMessageCount > 0
      );
    },

    isLoading: (messageId: string) => {
      const threadState = get().getThreadState(messageId);
      return (
        threadState.state === "loadingMore" ||
        threadState.state === "jumpingToLatest"
      );
    },
  })),
);

// Hook to get selectors for a specific thread
export const useThreadScrollSelectors = (messageId: string | null) => {
  const threadState = useThreadScrollState((s) =>
    messageId ? s.getThreadState(messageId) : getDefaultThreadState(),
  );
  const storeSend = useThreadScrollState((s) => s.send);
  const storeSetHasMorePages = useThreadScrollState((s) => s.setHasMorePages);
  const storeReset = useThreadScrollState((s) => s.reset);

  const { state, context } = threadState;

  // Memoize actions to prevent infinite loops in useEffect
  const send = useCallback(
    (event: ThreadScrollEvent) => {
      if (messageId) storeSend(messageId, event);
    },
    [messageId, storeSend],
  );

  const setHasMorePages = useCallback(
    (hasMore: boolean) => {
      if (messageId) storeSetHasMorePages(messageId, hasMore);
    },
    [messageId, storeSetHasMorePages],
  );

  const reset = useCallback(() => {
    if (messageId) storeReset(messageId);
  }, [messageId, storeReset]);

  // Memoize convenience methods
  const scrollToBottom = useCallback(
    () => send({ type: "SCROLL_TO_BOTTOM" }),
    [send],
  );
  const scrollAway = useCallback(() => send({ type: "SCROLL_AWAY" }), [send]);
  const newMessageArrived = useCallback(
    () => send({ type: "NEW_MESSAGE" }),
    [send],
  );
  const loadMore = useCallback(() => send({ type: "LOAD_MORE" }), [send]);
  const loadComplete = useCallback(
    () => send({ type: "LOAD_COMPLETE" }),
    [send],
  );
  const jumpToLatestAction = useCallback(
    () => send({ type: "JUMP_TO_LATEST" }),
    [send],
  );
  const refreshComplete = useCallback(
    () => send({ type: "REFRESH_COMPLETE" }),
    [send],
  );

  return useMemo(
    () => ({
      // Current state
      state,
      newMessageCount: context.newMessageCount,
      hasMorePages: context.hasMorePages,

      // Computed
      isInitializing: state === "initializing",
      isIdle: state === "idle",
      isBrowsing: state === "browsing",
      hasNewMessages: state === "hasNewMessages",
      isLoadingMore: state === "loadingMore",
      isJumpingToLatest: state === "jumpingToLatest",
      shouldShowIndicator:
        state === "hasNewMessages" && context.newMessageCount > 0,
      isLoading: state === "loadingMore" || state === "jumpingToLatest",

      // Actions (bound to messageId)
      send,
      setHasMorePages,
      reset,

      // Convenience methods
      scrollToBottom,
      scrollAway,
      newMessageArrived,
      loadMore,
      loadComplete,
      jumpToLatest: jumpToLatestAction,
      refreshComplete,
    }),
    [
      state,
      context.newMessageCount,
      context.hasMorePages,
      send,
      setHasMorePages,
      reset,
      scrollToBottom,
      scrollAway,
      newMessageArrived,
      loadMore,
      loadComplete,
      jumpToLatestAction,
      refreshComplete,
    ],
  );
};
