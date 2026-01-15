/**
 * WebSocket 事件常量
 *
 * 从 `@team9/shared` 重导出所有事件相关定义。
 *
 * @example
 * ```typescript
 * import { WS_EVENTS, JoinChannelPayload } from './events.constants.js';
 *
 * // 使用分组结构
 * client.emit(WS_EVENTS.CHANNEL.JOINED, data);
 * ```
 */
export { WS_EVENTS } from '@team9/shared';
export type { WsEventName } from '@team9/shared';

// 重新导出所有事件类型，方便 Gateway 使用
export type {
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
  ChannelOperationResponse,
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
  TypingOperationResponse,
  // User
  UserOnlineEvent,
  UserOfflineEvent,
  UserStatusChangedEvent,
  UpdateUserStatusPayload,
  UserStatusOperationResponse,
  // Reaction
  AddReactionPayload,
  RemoveReactionPayload,
  ReactionAddedEvent,
  ReactionRemovedEvent,
  ReactionOperationResponse,
  // Workspace
  JoinWorkspacePayload,
  WorkspaceMembersListEvent,
  WorkspaceMemberJoinedEvent,
  WorkspaceMemberLeftEvent,
  WorkspaceMemberRemovedEvent,
  WorkspaceOperationResponse,
  WorkspaceMember,
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
  // Type mappings
  ClientToServerEvents,
  ServerToClientEvents,
} from '@team9/shared';
