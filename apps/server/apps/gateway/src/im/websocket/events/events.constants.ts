/**
 * WebSocket Event Constants
 *
 * Re-exports all event-related definitions from `@team9/shared`.
 *
 * @example
 * ```typescript
 * import { WS_EVENTS, JoinChannelPayload } from './events.constants.js';
 *
 * // Use grouped structure
 * client.emit(WS_EVENTS.CHANNEL.JOINED, data);
 * ```
 */
export { WS_EVENTS } from '@team9/shared';
export type { WsEventName } from '@team9/shared';

// Re-export all event types for Gateway usage
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
