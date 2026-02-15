/**
 * WebSocket Events Module
 *
 * Provides shared WebSocket event names and type definitions for frontend and backend.
 *
 * @module events
 *
 * @example
 * ```typescript
 * // Backend usage
 * import { WS_EVENTS, ChannelJoinedEvent } from '@team9/shared';
 *
 * client.emit(WS_EVENTS.CHANNEL.JOINED, {
 *   channelId: '...',
 *   userId: '...',
 *   username: '...'
 * } satisfies ChannelJoinedEvent);
 *
 * // Frontend usage
 * import { WS_EVENTS, NewMessageEvent } from '@team9/shared';
 *
 * socket.on(WS_EVENTS.MESSAGE.NEW, (event: NewMessageEvent) => {
 *   // Handle new message
 * });
 * ```
 */

// Event name constants
export { WS_EVENTS } from './event-names.js';
export type { WsEventName } from './event-names.js';

// All event types
export * from './domains/index.js';

// ==================== Type Mappings ====================

import type {
  // Auth
  AuthenticatedEvent,
  AuthErrorEvent,
  // Channel
  JoinChannelPayload,
  LeaveChannelPayload,
  ChannelJoinedEvent,
  ChannelLeftEvent,
  ChannelCreatedEvent,
  ChannelUpdatedEvent,
  ChannelDeletedEvent,
  ChannelArchivedEvent,
  ChannelUnarchivedEvent,
  // Message
  NewMessageEvent,
  MessageUpdatedEvent,
  MessageDeletedEvent,
  MarkAsReadPayload,
  ReadStatusUpdatedEvent,
  // Typing
  TypingStartPayload,
  TypingStopPayload,
  UserTypingEvent,
  // User
  UserOnlineEvent,
  UserOfflineEvent,
  UserStatusChangedEvent,
  UpdateUserStatusPayload,
  // Reaction
  AddReactionPayload,
  RemoveReactionPayload,
  ReactionAddedEvent,
  ReactionRemovedEvent,
  // Workspace
  JoinWorkspacePayload,
  WorkspaceMembersListEvent,
  WorkspaceMemberJoinedEvent,
  WorkspaceMemberLeftEvent,
  WorkspaceMemberRemovedEvent,
  // System
  PingPayload,
  PongEvent,
  MessageAckPayload,
  MessageAckResponseEvent,
  MessageSentEvent,
  SessionExpiredEvent,
  SessionTimeoutEvent,
  SessionKickedEvent,
  SyncMessagesPayload,
  SyncMessagesResponseEvent,
  MessageRetryEvent,
  // Notification
  NotificationNewEvent,
  NotificationCountsUpdatedEvent,
  NotificationReadEvent,
  // Streaming (AI bot)
  StreamingStartEvent,
  StreamingDeltaEvent,
  StreamingThinkingDeltaEvent,
  StreamingEndEvent,
  StreamingAbortEvent,
} from './domains/index.js';

/**
 * Client to server events and their payload type mappings
 */
export interface ClientToServerEvents {
  // Channel
  join_channel: JoinChannelPayload;
  leave_channel: LeaveChannelPayload;
  // Message
  mark_as_read: MarkAsReadPayload;
  // Typing
  typing_start: TypingStartPayload;
  typing_stop: TypingStopPayload;
  // User
  update_user_status: UpdateUserStatusPayload;
  // Reaction
  add_reaction: AddReactionPayload;
  remove_reaction: RemoveReactionPayload;
  // Workspace
  join_workspace: JoinWorkspacePayload;
  // System
  ping: PingPayload;
  message_ack: MessageAckPayload;
  sync_messages: SyncMessagesPayload;
  // Streaming (bot -> server)
  streaming_start: StreamingStartEvent;
  streaming_delta: StreamingDeltaEvent;
  streaming_thinking_delta: StreamingThinkingDeltaEvent;
  streaming_end: StreamingEndEvent;
  streaming_abort: StreamingAbortEvent;
}

/**
 * Server to client events and their payload type mappings
 */
export interface ServerToClientEvents {
  // Auth
  authenticated: AuthenticatedEvent;
  auth_error: AuthErrorEvent;
  // Channel
  channel_joined: ChannelJoinedEvent;
  channel_left: ChannelLeftEvent;
  channel_created: ChannelCreatedEvent;
  channel_updated: ChannelUpdatedEvent;
  channel_deleted: ChannelDeletedEvent;
  channel_archived: ChannelArchivedEvent;
  channel_unarchived: ChannelUnarchivedEvent;
  // Message
  new_message: NewMessageEvent;
  message_updated: MessageUpdatedEvent;
  message_deleted: MessageDeletedEvent;
  read_status_updated: ReadStatusUpdatedEvent;
  // Typing
  user_typing: UserTypingEvent;
  // User
  user_online: UserOnlineEvent;
  user_offline: UserOfflineEvent;
  user_status_changed: UserStatusChangedEvent;
  // Reaction
  reaction_added: ReactionAddedEvent;
  reaction_removed: ReactionRemovedEvent;
  // Workspace
  workspace_members_list: WorkspaceMembersListEvent;
  workspace_member_joined: WorkspaceMemberJoinedEvent;
  workspace_member_left: WorkspaceMemberLeftEvent;
  workspace_member_removed: WorkspaceMemberRemovedEvent;
  // System
  pong: PongEvent;
  message_ack_response: MessageAckResponseEvent;
  message_sent: MessageSentEvent;
  session_expired: SessionExpiredEvent;
  session_timeout: SessionTimeoutEvent;
  session_kicked: SessionKickedEvent;
  sync_messages_response: SyncMessagesResponseEvent;
  message_retry: MessageRetryEvent;
  // Notification
  notification_new: NotificationNewEvent;
  notification_counts_updated: NotificationCountsUpdatedEvent;
  notification_read: NotificationReadEvent;
  // Streaming (server -> client broadcast)
  streaming_start: StreamingStartEvent;
  streaming_delta: StreamingDeltaEvent;
  streaming_thinking_delta: StreamingThinkingDeltaEvent;
  streaming_end: StreamingEndEvent;
  streaming_abort: StreamingAbortEvent;
}

/**
 * Interfaces for Socket.io typing
 *
 * @example
 * ```typescript
 * // Server side
 * import { Server } from 'socket.io';
 * import type { TypedSocketServer } from '@team9/shared';
 *
 * const io: TypedSocketServer = new Server();
 *
 * // Client side
 * import { io } from 'socket.io-client';
 * import type { TypedSocket } from '@team9/shared';
 *
 * const socket: TypedSocket = io();
 * ```
 */
export type TypedSocketServer = {
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    data: ServerToClientEvents[E],
  ): void;
  on<E extends keyof ClientToServerEvents>(
    event: E,
    handler: (data: ClientToServerEvents[E]) => void,
  ): void;
};

export type TypedSocket = {
  emit<E extends keyof ClientToServerEvents>(
    event: E,
    data: ClientToServerEvents[E],
  ): void;
  on<E extends keyof ServerToClientEvents>(
    event: E,
    handler: (data: ServerToClientEvents[E]) => void,
  ): void;
};
