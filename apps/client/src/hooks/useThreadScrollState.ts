import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

/**
 * Thread Scroll State Machine
 *
 * States:
 * - idle: User is at bottom, no pending new messages, ready for real-time updates
 * - browsing: User has scrolled away from bottom, browsing history
 * - hasNewMessages: New messages arrived while user was not at bottom
 * - loadingMore: Loading more historical messages (infinite scroll)
 * - jumpingToLatest: User triggered jump to latest, loading all pages and refreshing
 *
 * State Transitions:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                                                             │
 *   │  ┌──────┐  SCROLL_AWAY   ┌──────────┐                      │
 *   │  │ idle │ ────────────►  │ browsing │                      │
 *   │  └──────┘                └──────────┘                      │
 *   │     ▲                         │                            │
 *   │     │                         │ NEW_MESSAGE                │
 *   │     │                         ▼                            │
 *   │     │   SCROLL_TO_BOTTOM ┌────────────────┐               │
 *   │     │   (no new msgs)    │ hasNewMessages │               │
 *   │     │ ◄──────────────────└────────────────┘               │
 *   │     │                         │                            │
 *   │     │                         │ SCROLL_TO_BOTTOM           │
 *   │     │                         │ (with new msgs) or         │
 *   │     │                         │ JUMP_TO_LATEST             │
 *   │     │                         ▼                            │
 *   │     │   REFRESH_COMPLETE ┌──────────────────┐             │
 *   │     │ ◄──────────────────│ jumpingToLatest  │             │
 *   │     │                    └──────────────────┘             │
 *   │     │                                                      │
 *   │     │   LOAD_COMPLETE    ┌─────────────┐                  │
 *   │     │ ◄──────────────────│ loadingMore │                  │
 *   │                          └─────────────┘                   │
 *   │                               ▲                            │
 *   │                               │ LOAD_MORE                  │
 *   │                               │                            │
 *   └───────────────────────────────┴────────────────────────────┘
 *           (from any state except jumpingToLatest)
 */

// State types
export type ThreadScrollState =
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

interface ThreadScrollStore {
  // Current state
  state: ThreadScrollState;
  context: ThreadScrollContext;

  // Send event to trigger state transition
  send: (event: ThreadScrollEvent) => void;

  // Update context without changing state
  setHasMorePages: (hasMore: boolean) => void;

  // Computed selectors
  shouldShowIndicator: () => boolean;
  isLoading: () => boolean;
}

// State transition function (pure function)
function transition(
  currentState: ThreadScrollState,
  event: ThreadScrollEvent,
  context: ThreadScrollContext,
): { state: ThreadScrollState; context: ThreadScrollContext } {
  switch (currentState) {
    case "idle":
      switch (event.type) {
        case "SCROLL_AWAY":
          return { state: "browsing", context };
        case "NEW_MESSAGE":
          // In idle state, new messages are handled by React Query auto-refresh
          // No state change needed
          return { state: "idle", context };
        case "LOAD_MORE":
          return { state: "loadingMore", context };
        case "RESET":
          return {
            state: "idle",
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
            state: "idle",
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
            state: "idle",
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
            state: "idle",
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
            state: "idle",
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
    state: "idle" as ThreadScrollState,
    context: {
      newMessageCount: 0,
      hasMorePages: false,
    },

    send: (event: ThreadScrollEvent) => {
      const { state: currentState, context } = get();
      const result = transition(currentState, event, context);

      // Only update if state or context changed
      if (result.state !== currentState || result.context !== context) {
        set({ state: result.state, context: result.context });
      }
    },

    setHasMorePages: (hasMore: boolean) => {
      set((prev) => ({
        context: { ...prev.context, hasMorePages: hasMore },
      }));
    },

    shouldShowIndicator: () => {
      const { state, context } = get();
      return state === "hasNewMessages" && context.newMessageCount > 0;
    },

    isLoading: () => {
      const { state } = get();
      return state === "loadingMore" || state === "jumpingToLatest";
    },
  })),
);

// Selector hooks for components
export const useThreadScrollSelectors = () => {
  const state = useThreadScrollState((s) => s.state);
  const context = useThreadScrollState((s) => s.context);
  const send = useThreadScrollState((s) => s.send);
  const setHasMorePages = useThreadScrollState((s) => s.setHasMorePages);

  return {
    // Current state
    state,
    newMessageCount: context.newMessageCount,
    hasMorePages: context.hasMorePages,

    // Computed
    isIdle: state === "idle",
    isBrowsing: state === "browsing",
    hasNewMessages: state === "hasNewMessages",
    isLoadingMore: state === "loadingMore",
    isJumpingToLatest: state === "jumpingToLatest",
    shouldShowIndicator:
      state === "hasNewMessages" && context.newMessageCount > 0,
    isLoading: state === "loadingMore" || state === "jumpingToLatest",

    // Actions
    send,
    setHasMorePages,

    // Convenience methods
    scrollToBottom: () => send({ type: "SCROLL_TO_BOTTOM" }),
    scrollAway: () => send({ type: "SCROLL_AWAY" }),
    newMessageArrived: () => send({ type: "NEW_MESSAGE" }),
    loadMore: () => send({ type: "LOAD_MORE" }),
    loadComplete: () => send({ type: "LOAD_COMPLETE" }),
    jumpToLatest: () => send({ type: "JUMP_TO_LATEST" }),
    refreshComplete: () => send({ type: "REFRESH_COMPLETE" }),
    reset: () => send({ type: "RESET" }),
  };
};
