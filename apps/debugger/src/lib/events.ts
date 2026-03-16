/**
 * WebSocket event names — mirrored from @team9/shared.
 * Keep in sync with apps/server/libs/shared/src/events/event-names.ts
 */
export const WS_EVENTS = {
  AUTH: {
    AUTHENTICATED: "authenticated",
    AUTH_ERROR: "auth_error",
  },
  CHANNEL: {
    JOIN: "join_channel",
    LEAVE: "leave_channel",
    JOINED: "channel_joined",
    LEFT: "channel_left",
    CREATED: "channel_created",
    UPDATED: "channel_updated",
    DELETED: "channel_deleted",
  },
  MESSAGE: {
    NEW: "new_message",
    UPDATED: "message_updated",
    DELETED: "message_deleted",
  },
  READ_STATUS: {
    MARK_AS_READ: "mark_as_read",
    UPDATED: "read_status_updated",
  },
  TYPING: {
    START: "typing_start",
    STOP: "typing_stop",
    USER_TYPING: "user_typing",
  },
  USER: {
    ONLINE: "user_online",
    OFFLINE: "user_offline",
    STATUS_CHANGED: "user_status_changed",
  },
  REACTION: {
    ADD: "add_reaction",
    REMOVE: "remove_reaction",
    ADDED: "reaction_added",
    REMOVED: "reaction_removed",
  },
  WORKSPACE: {
    MEMBER_JOINED: "workspace_member_joined",
    MEMBER_LEFT: "workspace_member_left",
  },
  SYSTEM: {
    PING: "ping",
    PONG: "pong",
  },
  STREAMING: {
    START: "streaming_start",
    CONTENT: "streaming_content",
    THINKING_CONTENT: "streaming_thinking_content",
    END: "streaming_end",
    ABORT: "streaming_abort",
  },
  TASK: {
    STATUS_CHANGED: "task:status_changed",
    EXECUTION_CREATED: "task:execution_created",
  },
} as const;

/** Categorize events for filtering and coloring */
export type EventCategory =
  | "auth"
  | "channel"
  | "message"
  | "streaming"
  | "typing"
  | "presence"
  | "reaction"
  | "system"
  | "task"
  | "other";

export function getEventCategory(eventName: string): EventCategory {
  if (eventName.startsWith("streaming_")) return "streaming";
  if (
    eventName === "new_message" ||
    eventName === "message_updated" ||
    eventName === "message_deleted"
  )
    return "message";
  if (
    eventName === "typing_start" ||
    eventName === "typing_stop" ||
    eventName === "user_typing"
  )
    return "typing";
  if (
    eventName === "user_online" ||
    eventName === "user_offline" ||
    eventName === "user_status_changed"
  )
    return "presence";
  if (
    eventName.startsWith("reaction_") ||
    eventName.startsWith("add_reaction") ||
    eventName.startsWith("remove_reaction")
  )
    return "reaction";
  if (eventName === "authenticated" || eventName === "auth_error")
    return "auth";
  if (
    eventName.startsWith("channel_") ||
    eventName === "join_channel" ||
    eventName === "leave_channel"
  )
    return "channel";
  if (eventName === "ping" || eventName === "pong") return "system";
  if (eventName.startsWith("task:")) return "task";
  return "other";
}

/** Color mapping per category */
export const CATEGORY_COLORS: Record<EventCategory, string> = {
  auth: "#22c55e",
  channel: "#06b6d4",
  message: "#38bdf8",
  streaming: "#f59e0b",
  typing: "#8b5cf6",
  presence: "#a78bfa",
  reaction: "#ec4899",
  system: "#64748b",
  task: "#14b8a6",
  other: "#94a3b8",
};
