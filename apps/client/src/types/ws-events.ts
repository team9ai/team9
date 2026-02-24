/**
 * WebSocket event names and type definitions
 *
 * Note: These types should be consistent with backend @team9/shared/events
 */

// ==================== Event Name Constants ====================

export const WS_EVENTS = {
  // Connection related
  CONNECTION: {
    CONNECT: "connection",
    DISCONNECT: "disconnect",
    ERROR: "error",
  },

  // Authentication related
  AUTH: {
    AUTHENTICATE: "authenticate",
    AUTHENTICATED: "authenticated",
    AUTH_ERROR: "auth_error",
  },

  // Channel operations
  CHANNEL: {
    JOIN: "join_channel",
    LEAVE: "leave_channel",
    JOINED: "channel_joined",
    LEFT: "channel_left",
    CREATED: "channel_created",
    UPDATED: "channel_updated",
    DELETED: "channel_deleted",
    ARCHIVED: "channel_archived",
    UNARCHIVED: "channel_unarchived",
  },

  // Message operations
  MESSAGE: {
    NEW: "new_message",
    UPDATED: "message_updated",
    DELETED: "message_deleted",
  },

  // Read status
  READ_STATUS: {
    MARK_AS_READ: "mark_as_read",
    UPDATED: "read_status_updated",
  },

  // Typing status
  TYPING: {
    START: "typing_start",
    STOP: "typing_stop",
    USER_TYPING: "user_typing",
  },

  // User status
  USER: {
    ONLINE: "user_online",
    OFFLINE: "user_offline",
    STATUS_CHANGED: "user_status_changed",
  },

  // Message reactions
  REACTION: {
    ADD: "add_reaction",
    REMOVE: "remove_reaction",
    ADDED: "reaction_added",
    REMOVED: "reaction_removed",
  },

  // Workspace
  WORKSPACE: {
    JOIN: "join_workspace",
    MEMBERS_LIST: "workspace_members_list",
    MEMBER_JOINED: "workspace_member_joined",
    MEMBER_LEFT: "workspace_member_left",
    MEMBER_REMOVED: "workspace_member_removed",
  },

  // System events
  SYSTEM: {
    PING: "ping",
    PONG: "pong",
    MESSAGE_ACK: "message_ack",
    MESSAGE_ACK_RESPONSE: "message_ack_response",
    MESSAGE_SENT: "message_sent",
  },

  // Session management
  SESSION: {
    EXPIRED: "session_expired",
    TIMEOUT: "session_timeout",
    KICKED: "session_kicked",
  },

  // Message sync
  SYNC: {
    MESSAGES: "sync_messages",
    MESSAGES_RESPONSE: "sync_messages_response",
    MESSAGE_RETRY: "message_retry",
  },

  // Notifications
  NOTIFICATION: {
    NEW: "notification_new",
    COUNTS_UPDATED: "notification_counts_updated",
    READ: "notification_read",
  },

  // AI Streaming (Bot)
  STREAMING: {
    START: "streaming_start",
    CONTENT: "streaming_content",
    THINKING_CONTENT: "streaming_thinking_content",
    END: "streaming_end",
    ABORT: "streaming_abort",
  },
} as const;

// ==================== Authentication Event Types ====================

/** Authentication success event */
export interface AuthenticatedEvent {
  userId: string;
}

/** Authentication error event */
export interface AuthErrorEvent {
  message: string;
}

// ==================== Channel Event Types ====================

/** Join channel request */
export interface JoinChannelPayload {
  channelId: string;
}

/** Leave channel request */
export interface LeaveChannelPayload {
  channelId: string;
}

/** Channel joined event */
export interface ChannelJoinedEvent {
  channelId: string;
  userId: string;
  username: string;
}

/** Channel left event */
export interface ChannelLeftEvent {
  channelId: string;
  userId: string;
}

/** Channel created event */
export interface ChannelCreatedEvent {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  type: "direct" | "public" | "private";
  createdBy: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Channel updated event */
export interface ChannelUpdatedEvent {
  channelId: string;
  name?: string;
  description?: string;
  avatarUrl?: string;
  updatedBy: string;
  updatedAt: string;
}

/** Channel deleted event */
export interface ChannelDeletedEvent {
  channelId: string;
  channelName?: string;
  deletedBy: string;
}

/** Channel archived event */
export interface ChannelArchivedEvent {
  channelId: string;
  channelName?: string;
  archivedBy: string;
}

/** Channel unarchived event */
export interface ChannelUnarchivedEvent {
  channelId: string;
  channelName?: string;
  unarchivedBy: string;
}

// ==================== Message Event Types ====================

import type { Message } from "./im";

/** New message event */
export type NewMessageEvent = Message;

/** Message updated event */
export type MessageUpdatedEvent = Message;

/** Message deleted event */
export interface MessageDeletedEvent {
  messageId: string;
  channelId?: string;
}

/** Mark as read request */
export interface MarkAsReadPayload {
  channelId: string;
  messageId: string;
}

/** Read status updated event */
export interface ReadStatusUpdatedEvent {
  channelId: string;
  userId: string;
  lastReadMessageId: string;
}

// ==================== Typing Status Event Types ====================

/** Typing start request */
export interface TypingStartPayload {
  channelId: string;
}

/** Typing stop request */
export interface TypingStopPayload {
  channelId: string;
}

/** User typing event */
export interface UserTypingEvent {
  channelId: string;
  userId: string;
  username: string;
  isTyping: boolean;
}

// ==================== User Status Event Types ====================

import type { UserStatus } from "./im";

/** User online event */
export interface UserOnlineEvent {
  userId: string;
  username: string;
  workspaceId: string;
}

/** User offline event */
export interface UserOfflineEvent {
  userId: string;
  workspaceId: string;
}

/** User status changed event */
export interface UserStatusChangedEvent {
  userId: string;
  status: UserStatus;
  statusMessage?: string;
  changedAt?: string;
}

// ==================== Reaction Event Types ====================

/** Add reaction request */
export interface AddReactionPayload {
  messageId: string;
  emoji: string;
}

/** Remove reaction request */
export interface RemoveReactionPayload {
  messageId: string;
  emoji: string;
}

/** Reaction added event */
export interface ReactionAddedEvent {
  messageId: string;
  userId: string;
  emoji: string;
}

/** Reaction removed event */
export interface ReactionRemovedEvent {
  messageId: string;
  userId: string;
  emoji: string;
}

// ==================== Workspace Event Types ====================

/** Join workspace request */
export interface JoinWorkspacePayload {
  workspaceId: string;
}

/** Workspace member */
export interface WorkspaceMember {
  id: string;
  userId: string;
  workspaceId: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
  user?: {
    id: string;
    username: string;
    displayName?: string;
    email: string;
    avatarUrl?: string;
    status: UserStatus;
  };
}

/** Workspace members list event */
export interface WorkspaceMembersListEvent {
  workspaceId: string;
  members: WorkspaceMember[];
}

/** Workspace member joined event */
export interface WorkspaceMemberJoinedEvent {
  workspaceId: string;
  member: WorkspaceMember;
}

/** Workspace member left event */
export interface WorkspaceMemberLeftEvent {
  workspaceId: string;
  userId: string;
  username?: string;
}

/** Workspace member removed event */
export interface WorkspaceMemberRemovedEvent {
  workspaceId: string;
  userId: string;
  username?: string;
  removedBy: string;
}

// ==================== System Event Types ====================

/** Ping request */
export interface PingPayload {
  timestamp: number;
}

/** Pong response */
export interface PongEvent {
  type: "pong";
  timestamp: number;
  serverTime: number;
}

/** Message acknowledgment request */
export interface MessageAckPayload {
  msgId: string;
  ackType: "delivered" | "read";
}

/** Message acknowledgment response */
export interface MessageAckResponseEvent {
  msgId: string;
  status: "received" | "error";
  error?: string;
}

/** Message sent confirmation event */
export interface MessageSentEvent {
  msgId: string;
  clientMsgId?: string;
  seqId: string;
  serverTime: number;
}

/** Session expired event */
export interface SessionExpiredEvent {
  reason: string;
  expiredAt?: string;
}

/** Session timeout event */
export interface SessionTimeoutEvent {
  reason: string;
  lastActiveAt?: string;
}

/** Kicked by another device event */
export interface SessionKickedEvent {
  reason: string;
  newDeviceInfo?: {
    platform: string;
    version?: string;
  };
}

// ==================== Notification Event Types ====================

import type {
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  NotificationActor,
} from "@/stores/useNotificationStore";

/** New notification event */
export interface NotificationNewEvent {
  id: string;
  category: NotificationCategory;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  actor: NotificationActor | null;
  tenantId: string | null;
  channelId: string | null;
  messageId: string | null;
  actionUrl: string | null;
  createdAt: string;
}

/** Notification counts updated event */
export interface NotificationCountsUpdatedEvent {
  total: number;
  byCategory: {
    message: number;
    system: number;
    workspace: number;
  };
  byType: {
    mention: number;
    channel_mention: number;
    everyone_mention: number;
    here_mention: number;
    reply: number;
    thread_reply: number;
    dm_received: number;
    system_announcement: number;
    maintenance_notice: number;
    version_update: number;
    workspace_invitation: number;
    role_changed: number;
    member_joined: number;
    member_left: number;
    channel_invite: number;
  };
}

/** Notification read event (multi-device sync) */
export interface NotificationReadEvent {
  notificationIds: string[];
  readAt: string;
}

// ==================== Streaming Event Types (AI Bot) ====================

/** Streaming start - bot begins generating a response */
export interface StreamingStartEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  parentId?: string;
  startedAt: number;
}

/** Streaming text update - full accumulated content */
export interface StreamingContentEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  content: string;
}

/** Streaming thinking update - full accumulated reasoning content */
export interface StreamingThinkingContentEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  content: string;
}

/** Streaming end - finalization with persisted message */
export interface StreamingEndEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  message: Message;
}

/** Streaming abort - stream terminated before completion */
export interface StreamingAbortEvent {
  streamId: string;
  channelId: string;
  senderId: string;
  reason: "error" | "cancelled" | "timeout" | "disconnect";
  error?: string;
}

// ==================== Type Mappings ====================

/** Client to server events and their payload type mappings */
export interface ClientToServerEvents {
  join_channel: JoinChannelPayload;
  leave_channel: LeaveChannelPayload;
  mark_as_read: MarkAsReadPayload;
  typing_start: TypingStartPayload;
  typing_stop: TypingStopPayload;
  add_reaction: AddReactionPayload;
  remove_reaction: RemoveReactionPayload;
  join_workspace: JoinWorkspacePayload;
  ping: PingPayload;
  message_ack: MessageAckPayload;
}

/** Server to client events and their payload type mappings */
export interface ServerToClientEvents {
  authenticated: AuthenticatedEvent;
  auth_error: AuthErrorEvent;
  channel_joined: ChannelJoinedEvent;
  channel_left: ChannelLeftEvent;
  channel_created: ChannelCreatedEvent;
  channel_updated: ChannelUpdatedEvent;
  channel_deleted: ChannelDeletedEvent;
  channel_archived: ChannelArchivedEvent;
  channel_unarchived: ChannelUnarchivedEvent;
  new_message: NewMessageEvent;
  message_updated: MessageUpdatedEvent;
  message_deleted: MessageDeletedEvent;
  read_status_updated: ReadStatusUpdatedEvent;
  user_typing: UserTypingEvent;
  user_online: UserOnlineEvent;
  user_offline: UserOfflineEvent;
  user_status_changed: UserStatusChangedEvent;
  reaction_added: ReactionAddedEvent;
  reaction_removed: ReactionRemovedEvent;
  workspace_members_list: WorkspaceMembersListEvent;
  workspace_member_joined: WorkspaceMemberJoinedEvent;
  workspace_member_left: WorkspaceMemberLeftEvent;
  workspace_member_removed: WorkspaceMemberRemovedEvent;
  pong: PongEvent;
  message_ack_response: MessageAckResponseEvent;
  message_sent: MessageSentEvent;
  session_expired: SessionExpiredEvent;
  session_timeout: SessionTimeoutEvent;
  session_kicked: SessionKickedEvent;
  notification_new: NotificationNewEvent;
  notification_counts_updated: NotificationCountsUpdatedEvent;
  notification_read: NotificationReadEvent;
  // Streaming (AI bot)
  streaming_start: StreamingStartEvent;
  streaming_content: StreamingContentEvent;
  streaming_thinking_content: StreamingThinkingContentEvent;
  streaming_end: StreamingEndEvent;
  streaming_abort: StreamingAbortEvent;
}
