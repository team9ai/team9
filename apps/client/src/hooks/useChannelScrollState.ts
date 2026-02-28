import { create } from "zustand";

/**
 * Channel Scroll State Machine
 *
 * Manages scroll behavior for the main channel message list.
 * Keyed by channelId for multi-channel support.
 *
 * States:
 * - initializing: Channel just opened, waiting for first scroll position confirmation
 * - idle: User is at bottom, new messages auto-scroll
 * - browsing: User scrolled away from bottom
 * - hasNewMessages: New messages arrived while user was not at bottom
 * - loadingMore: Loading older messages (infinite scroll)
 * - jumpingToLatest: User triggered jump to latest
 *
 * State Transitions:
 *
 *   initializing ── SCROLL_TO_BOTTOM ──► idle
 *                                          │
 *                        SCROLL_AWAY ──────┤
 *                                          ▼
 *   idle ◄── SCROLL_TO_BOTTOM ── browsing
 *     │                              │
 *     │ SCROLL_AWAY                  │ NEW_MESSAGE
 *     ▼                              ▼
 *   browsing ◄────────────── hasNewMessages
 *                                    │
 *                    JUMP_TO_LATEST  │
 *                                    ▼
 *   idle ◄── REFRESH_COMPLETE ── jumpingToLatest
 */

export type ChannelScrollState =
  | "initializing"
  | "idle"
  | "browsing"
  | "hasNewMessages"
  | "loadingMore"
  | "jumpingToLatest";

export type ChannelScrollEvent =
  | { type: "SCROLL_TO_BOTTOM" }
  | { type: "SCROLL_AWAY" }
  | { type: "NEW_MESSAGE" }
  | { type: "LOAD_MORE" }
  | { type: "LOAD_COMPLETE" }
  | { type: "JUMP_TO_LATEST" }
  | { type: "REFRESH_COMPLETE" }
  | { type: "RESET" };

interface ChannelScrollContext {
  newMessageCount: number;
  hasOlderPages: boolean;
}

interface ChannelStateData {
  state: ChannelScrollState;
  context: ChannelScrollContext;
}

const getDefaultState = (): ChannelStateData => ({
  state: "initializing",
  context: {
    newMessageCount: 0,
    hasOlderPages: false,
  },
});

// Pure state transition function
function transition(
  currentState: ChannelScrollState,
  event: ChannelScrollEvent,
  context: ChannelScrollContext,
): { state: ChannelScrollState; context: ChannelScrollContext } {
  switch (currentState) {
    case "initializing":
      switch (event.type) {
        case "SCROLL_TO_BOTTOM":
          return { state: "idle", context };
        case "SCROLL_AWAY":
          return { state: "browsing", context };
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
          return { state: "initializing", context: getDefaultState().context };
        default:
          return { state: currentState, context };
      }

    case "idle":
      switch (event.type) {
        case "SCROLL_AWAY":
          return { state: "browsing", context };
        case "NEW_MESSAGE":
          // At bottom - auto-scroll handles it, stay idle
          return { state: "idle", context };
        case "LOAD_MORE":
          return { state: "loadingMore", context };
        case "RESET":
          return { state: "initializing", context: getDefaultState().context };
        default:
          return { state: currentState, context };
      }

    case "browsing":
      switch (event.type) {
        case "SCROLL_TO_BOTTOM":
          return { state: "idle", context: { ...context, newMessageCount: 0 } };
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
          return { state: "initializing", context: getDefaultState().context };
        default:
          return { state: currentState, context };
      }

    case "hasNewMessages":
      switch (event.type) {
        case "SCROLL_TO_BOTTOM":
          // User scrolled to bottom - clear new message count, go idle
          return { state: "idle", context: { ...context, newMessageCount: 0 } };
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
          return { state: currentState, context };
        case "RESET":
          return { state: "initializing", context: getDefaultState().context };
        default:
          return { state: currentState, context };
      }

    case "loadingMore":
      switch (event.type) {
        case "LOAD_COMPLETE":
          if (context.newMessageCount > 0) {
            return { state: "hasNewMessages", context };
          }
          return { state: "browsing", context };
        case "NEW_MESSAGE":
          return {
            state: "loadingMore",
            context: {
              ...context,
              newMessageCount: context.newMessageCount + 1,
            },
          };
        case "RESET":
          return { state: "initializing", context: getDefaultState().context };
        default:
          return { state: currentState, context };
      }

    case "jumpingToLatest":
      switch (event.type) {
        case "REFRESH_COMPLETE":
          return { state: "idle", context: { ...context, newMessageCount: 0 } };
        case "NEW_MESSAGE":
          return { state: currentState, context };
        case "RESET":
          return { state: "initializing", context: getDefaultState().context };
        default:
          return { state: currentState, context };
      }

    default:
      return { state: currentState, context };
  }
}

interface ChannelScrollStore {
  channels: Record<string, ChannelStateData>;

  send: (channelId: string, event: ChannelScrollEvent) => void;
  getChannelState: (channelId: string) => ChannelStateData;
  setHasOlderPages: (channelId: string, hasOlder: boolean) => void;
  reset: (channelId: string) => void;
  remove: (channelId: string) => void;

  shouldShowIndicator: (channelId: string) => boolean;
}

export const useChannelScrollStore = create<ChannelScrollStore>()(
  (set, get) => ({
    channels: {},

    send: (channelId, event) => {
      set((state) => {
        const current = state.channels[channelId] || getDefaultState();
        const next = transition(current.state, event, current.context);
        return {
          channels: {
            ...state.channels,
            [channelId]: next,
          },
        };
      });
    },

    getChannelState: (channelId) => {
      return get().channels[channelId] || getDefaultState();
    },

    setHasOlderPages: (channelId, hasOlder) => {
      set((state) => {
        const current = state.channels[channelId] || getDefaultState();
        return {
          channels: {
            ...state.channels,
            [channelId]: {
              ...current,
              context: { ...current.context, hasOlderPages: hasOlder },
            },
          },
        };
      });
    },

    reset: (channelId) => {
      set((state) => ({
        channels: {
          ...state.channels,
          [channelId]: getDefaultState(),
        },
      }));
    },

    remove: (channelId) => {
      set((state) => {
        const { [channelId]: _, ...rest } = state.channels;
        return { channels: rest };
      });
    },

    shouldShowIndicator: (channelId) => {
      const data = get().channels[channelId];
      return (
        data?.state === "hasNewMessages" && data.context.newMessageCount > 0
      );
    },
  }),
);
