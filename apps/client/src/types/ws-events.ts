/**
 * WebSocket 事件名称和类型定义
 *
 * 注意：这些类型应与后端 @team9/shared/events 保持一致
 */

// ==================== 事件名称常量 ====================

export const WS_EVENTS = {
  // 连接相关
  CONNECTION: {
    CONNECT: "connection",
    DISCONNECT: "disconnect",
    ERROR: "error",
  },

  // 认证相关
  AUTH: {
    AUTHENTICATE: "authenticate",
    AUTHENTICATED: "authenticated",
    AUTH_ERROR: "auth_error",
  },

  // 频道操作
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

  // 消息操作
  MESSAGE: {
    NEW: "new_message",
    UPDATED: "message_updated",
    DELETED: "message_deleted",
  },

  // 读取状态
  READ_STATUS: {
    MARK_AS_READ: "mark_as_read",
    UPDATED: "read_status_updated",
  },

  // 打字状态
  TYPING: {
    START: "typing_start",
    STOP: "typing_stop",
    USER_TYPING: "user_typing",
  },

  // 用户状态
  USER: {
    ONLINE: "user_online",
    OFFLINE: "user_offline",
    STATUS_CHANGED: "user_status_changed",
  },

  // 消息反应
  REACTION: {
    ADD: "add_reaction",
    REMOVE: "remove_reaction",
    ADDED: "reaction_added",
    REMOVED: "reaction_removed",
  },

  // 提及通知
  MENTION: {
    RECEIVED: "mention_received",
  },

  // 工作空间
  WORKSPACE: {
    JOIN: "join_workspace",
    MEMBERS_LIST: "workspace_members_list",
    MEMBER_JOINED: "workspace_member_joined",
    MEMBER_LEFT: "workspace_member_left",
    MEMBER_REMOVED: "workspace_member_removed",
  },

  // 系统事件
  SYSTEM: {
    PING: "ping",
    PONG: "pong",
    MESSAGE_ACK: "message_ack",
    MESSAGE_ACK_RESPONSE: "message_ack_response",
    MESSAGE_SENT: "message_sent",
  },

  // 会话管理
  SESSION: {
    EXPIRED: "session_expired",
    TIMEOUT: "session_timeout",
    KICKED: "session_kicked",
  },

  // 消息同步
  SYNC: {
    MESSAGES: "sync_messages",
    MESSAGES_RESPONSE: "sync_messages_response",
    MESSAGE_RETRY: "message_retry",
  },
} as const;

// ==================== 认证事件类型 ====================

/** 认证成功事件 */
export interface AuthenticatedEvent {
  userId: string;
}

/** 认证错误事件 */
export interface AuthErrorEvent {
  message: string;
}

// ==================== 频道事件类型 ====================

/** 加入频道请求 */
export interface JoinChannelPayload {
  channelId: string;
}

/** 离开频道请求 */
export interface LeaveChannelPayload {
  channelId: string;
}

/** 频道已加入事件 */
export interface ChannelJoinedEvent {
  channelId: string;
  userId: string;
  username: string;
}

/** 频道已离开事件 */
export interface ChannelLeftEvent {
  channelId: string;
  userId: string;
}

/** 频道已创建事件 */
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

/** 频道已更新事件 */
export interface ChannelUpdatedEvent {
  channelId: string;
  name?: string;
  description?: string;
  avatarUrl?: string;
  updatedBy: string;
  updatedAt: string;
}

/** 频道已删除事件 */
export interface ChannelDeletedEvent {
  channelId: string;
  channelName?: string;
  deletedBy: string;
}

/** 频道已归档事件 */
export interface ChannelArchivedEvent {
  channelId: string;
  channelName?: string;
  archivedBy: string;
}

/** 频道已取消归档事件 */
export interface ChannelUnarchivedEvent {
  channelId: string;
  channelName?: string;
  unarchivedBy: string;
}

// ==================== 消息事件类型 ====================

import type { Message } from "./im";

/** 新消息事件 */
export type NewMessageEvent = Message;

/** 消息已更新事件 */
export type MessageUpdatedEvent = Message;

/** 消息已删除事件 */
export interface MessageDeletedEvent {
  messageId: string;
  channelId?: string;
}

/** 标记已读请求 */
export interface MarkAsReadPayload {
  channelId: string;
  messageId: string;
}

/** 读取状态已更新事件 */
export interface ReadStatusUpdatedEvent {
  channelId: string;
  userId: string;
  lastReadMessageId: string;
}

// ==================== 打字状态事件类型 ====================

/** 开始打字请求 */
export interface TypingStartPayload {
  channelId: string;
}

/** 停止打字请求 */
export interface TypingStopPayload {
  channelId: string;
}

/** 用户正在打字事件 */
export interface UserTypingEvent {
  channelId: string;
  userId: string;
  username: string;
  isTyping: boolean;
}

// ==================== 用户状态事件类型 ====================

import type { UserStatus } from "./im";

/** 用户上线事件 */
export interface UserOnlineEvent {
  userId: string;
  username: string;
  workspaceId: string;
}

/** 用户离线事件 */
export interface UserOfflineEvent {
  userId: string;
  workspaceId: string;
}

/** 用户状态变更事件 */
export interface UserStatusChangedEvent {
  userId: string;
  status: UserStatus;
  statusMessage?: string;
  changedAt?: string;
}

// ==================== 反应事件类型 ====================

/** 添加反应请求 */
export interface AddReactionPayload {
  messageId: string;
  emoji: string;
}

/** 移除反应请求 */
export interface RemoveReactionPayload {
  messageId: string;
  emoji: string;
}

/** 反应已添加事件 */
export interface ReactionAddedEvent {
  messageId: string;
  userId: string;
  emoji: string;
}

/** 反应已移除事件 */
export interface ReactionRemovedEvent {
  messageId: string;
  userId: string;
  emoji: string;
}

// ==================== 工作空间事件类型 ====================

/** 加入工作空间请求 */
export interface JoinWorkspacePayload {
  workspaceId: string;
}

/** 工作空间成员 */
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

/** 工作空间成员列表事件 */
export interface WorkspaceMembersListEvent {
  workspaceId: string;
  members: WorkspaceMember[];
}

/** 工作空间成员加入事件 */
export interface WorkspaceMemberJoinedEvent {
  workspaceId: string;
  member: WorkspaceMember;
}

/** 工作空间成员离开事件 */
export interface WorkspaceMemberLeftEvent {
  workspaceId: string;
  userId: string;
  username?: string;
}

/** 工作空间成员被移除事件 */
export interface WorkspaceMemberRemovedEvent {
  workspaceId: string;
  userId: string;
  username?: string;
  removedBy: string;
}

// ==================== 系统事件类型 ====================

/** 心跳请求 */
export interface PingPayload {
  timestamp: number;
}

/** 心跳响应 */
export interface PongEvent {
  type: "pong";
  timestamp: number;
  serverTime: number;
}

/** 消息确认请求 */
export interface MessageAckPayload {
  msgId: string;
  ackType: "delivered" | "read";
}

/** 消息确认响应 */
export interface MessageAckResponseEvent {
  msgId: string;
  status: "received" | "error";
  error?: string;
}

/** 消息已发送确认事件 */
export interface MessageSentEvent {
  msgId: string;
  clientMsgId?: string;
  seqId: string;
  serverTime: number;
}

/** 会话过期事件 */
export interface SessionExpiredEvent {
  reason: string;
  expiredAt?: string;
}

/** 会话超时事件 */
export interface SessionTimeoutEvent {
  reason: string;
  lastActiveAt?: string;
}

/** 被其他设备踢出事件 */
export interface SessionKickedEvent {
  reason: string;
  newDeviceInfo?: {
    platform: string;
    version?: string;
  };
}

/** 提及类型 */
export type MentionType = "user" | "channel" | "everyone" | "here";

/** 收到提及事件 */
export interface MentionReceivedEvent {
  mentionId: string;
  messageId: string;
  channelId: string;
  type: MentionType;
  senderId: string;
  senderUsername: string;
  messagePreview: string;
  createdAt: string;
}

// ==================== 类型映射 ====================

/** 客户端发送的事件及其 payload 类型映射 */
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

/** 服务器发送的事件及其 payload 类型映射 */
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
  mention_received: MentionReceivedEvent;
}
