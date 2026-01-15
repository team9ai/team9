/**
 * WebSocket 事件模块
 *
 * 提供前后端共享的 WebSocket 事件名称和类型定义。
 *
 * @module events
 *
 * @example
 * ```typescript
 * // 后端使用
 * import { WS_EVENTS, ChannelJoinedEvent } from '@team9/shared';
 *
 * client.emit(WS_EVENTS.CHANNEL.JOINED, {
 *   channelId: '...',
 *   userId: '...',
 *   username: '...'
 * } satisfies ChannelJoinedEvent);
 *
 * // 前端使用
 * import { WS_EVENTS, NewMessageEvent } from '@team9/shared';
 *
 * socket.on(WS_EVENTS.MESSAGE.NEW, (event: NewMessageEvent) => {
 *   // 处理新消息
 * });
 * ```
 */

// 事件名称常量
export { WS_EVENTS } from './event-names.js';
export type { WsEventName } from './event-names.js';

// 所有事件类型
export * from './domains/index.js';

// ==================== 类型映射 ====================

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
  MentionReceivedEvent,
} from './domains/index.js';

/**
 * 客户端发送的事件及其 payload 类型映射
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
}

/**
 * 服务器发送的事件及其 payload 类型映射
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
  mention_received: MentionReceivedEvent;
}

/**
 * 用于 Socket.io 类型化的接口
 *
 * @example
 * ```typescript
 * // 服务器端
 * import { Server } from 'socket.io';
 * import type { TypedSocketServer } from '@team9/shared';
 *
 * const io: TypedSocketServer = new Server();
 *
 * // 客户端
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
