// IM Types matching gateway API

export type ChannelType =
  | "direct"
  | "public"
  | "private"
  | "task"
  | "tracking"
  | "echo";
export type MessageType =
  | "text"
  | "file"
  | "image"
  | "system"
  | "tracking"
  | "long_text";
export type MemberRole = "owner" | "admin" | "member";
export type UserStatus = "online" | "offline" | "away" | "busy";
export type MessageSendStatus = "sending" | "sent" | "failed";
export type AgentType = "base_model" | "openclaw";

export interface AgentEventMetadata {
  agentEventType:
    | "thinking"
    | "writing"
    | "tool_call"
    | "tool_result"
    | "agent_start"
    | "agent_end"
    | "error"
    | "turn_separator"
    | "a2ui_surface_update"
    | "a2ui_response";
  status:
    | "running"
    | "completed"
    | "failed"
    | "resolved"
    | "timeout"
    | "cancelled";
  toolName?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  success?: boolean;
  surfaceId?: string;
  payload?: unknown[];
  surfaceMetadata?: Record<string, unknown>;
  selections?: Record<string, { selected: string[]; otherText: string | null }>;
  responderId?: string;
  responderName?: string;

  // === Thinking event fields ===
  /** Thinking content text (for thinking events) — Agent 的思考内容文本 */
  thinking?: string;
  /** Input tokens consumed during thinking — Thinking 过程消耗的输入 token 数 */
  inputTokens?: number;
  /** Output tokens produced during thinking — Thinking 过程产生的输出 token 数 */
  outputTokens?: number;
  /** Total tokens (input + output, for convenience) — 总 token 数（input + output） */
  totalTokens?: number;
  /** Duration in milliseconds — Thinking 持续时长（毫秒） */
  durationMs?: number;
  /** ISO timestamp when thinking started (for live elapsed display) — Thinking 开始时间（ISO 格式，用于实时显示已耗时） */
  startedAt?: string;
}

export interface ChannelSnapshot {
  totalMessageCount: number;
  latestMessages: Array<{
    id: string;
    content: string;
    metadata: AgentEventMetadata;
    createdAt: string;
  }>;
}

export interface IMUser {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  status: UserStatus;
  lastSeenAt?: string;
  isActive: boolean;
  userType?: "human" | "bot" | "system";
  agentType?: AgentType | null;
  createdAt: string;
  updatedAt: string;
}

export interface Channel {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  type: ChannelType;
  createdBy: string;
  sectionId?: string | null;
  order: number;
  isArchived: boolean;
  isActivated: boolean;
  snapshot?: ChannelSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelWithUnread extends Channel {
  unreadCount: number;
  lastReadMessageId?: string;
  lastReadAt?: string;
  otherUser?: {
    id: string;
    username: string;
    displayName?: string;
    avatarUrl?: string;
    status: UserStatus;
    userType?: "human" | "bot" | "system";
    agentType?: AgentType | null;
  };
}

export interface PublicChannelPreview extends Channel {
  isMember: boolean;
  memberCount: number;
}

export interface ChannelMember {
  id: string;
  channelId: string;
  userId: string;
  role: MemberRole;
  isMuted: boolean;
  notificationsEnabled: boolean;
  joinedAt: string;
  leftAt?: string;
  user?: IMUser;
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  fileKey: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface MessageReaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
  user?: IMUser;
}

export interface Message {
  id: string;
  channelId: string;
  clientMsgId?: string;
  senderId: string | null;
  parentId?: string;
  rootId?: string;
  content: string;
  type: MessageType;
  metadata?: Record<string, unknown>;
  isPinned: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  sender?: IMUser;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  isTruncated?: boolean;
  fullContentLength?: number;
  replyCount?: number;
  lastRepliers?: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    userType: string;
    agentType?: AgentType | null;
  }[];
  lastReplyAt?: string;
  // Client-side only fields for optimistic updates
  sendStatus?: MessageSendStatus;
  // Original request data for retry (only present when sendStatus is 'failed')
  _retryData?: CreateMessageDto;
}

// Thread response types for nested replies (max 2 levels)
export interface ThreadReply extends Message {
  subReplies: Message[];
  subReplyCount: number;
}

export interface ThreadResponse {
  rootMessage: Message;
  replies: ThreadReply[];
  totalReplyCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface SubRepliesResponse {
  replies: Message[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface GetThreadParams {
  limit?: number;
  cursor?: string;
}

export interface GetSubRepliesParams {
  limit?: number;
  cursor?: string;
}

// API Request/Response types
export interface CreateChannelDto {
  name: string;
  description?: string;
  type: ChannelType;
  avatarUrl?: string;
}

export interface UpdateChannelDto {
  name?: string;
  description?: string;
  avatarUrl?: string;
  isArchived?: boolean;
}

export interface DeleteChannelDto {
  confirmationName?: string;
  permanent?: boolean;
}

export interface AttachmentDto {
  fileKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface CreateMessageDto {
  content: string;
  clientMsgId?: string;
  parentId?: string;
  attachments?: AttachmentDto[];
  metadata?: Record<string, unknown>;
}

export interface UpdateMessageDto {
  content: string;
}

export interface AddMemberDto {
  userId: string;
  role?: MemberRole;
}

export interface UpdateMemberDto {
  role?: MemberRole;
  isMuted?: boolean;
  notificationsEnabled?: boolean;
}

export interface MarkAsReadDto {
  messageId: string;
}

export interface AddReactionDto {
  emoji: string;
}

export interface UpdateUserStatusDto {
  status: UserStatus;
}

export interface GetMessagesParams {
  limit?: number;
  before?: string;
  after?: string;
  around?: string;
}

export interface PaginatedMessagesResponse {
  messages: Message[];
  hasOlder: boolean;
  hasNewer: boolean;
}

export interface SearchUsersParams {
  q: string;
  limit?: number;
}

// WebSocket event types have been moved to @/types/ws-events.ts
// Import from there for WebSocket related types

// ============ Incremental Sync Types ============

/**
 * Response for syncing messages from a single channel
 */
export interface SyncMessagesResponse {
  channelId: string;
  messages: SyncMessageItem[];
  fromSeqId: string;
  toSeqId: string;
  hasMore: boolean;
}

/**
 * Simplified message item for sync response
 */
export interface SyncMessageItem {
  id: string;
  channelId: string;
  senderId: string | null;
  parentId: string | null;
  rootId: string | null;
  content: string | null;
  type: string;
  seqId: string;
  isPinned: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  sender?: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    agentType?: AgentType | null;
  };
}

/**
 * Request to acknowledge sync position
 */
export interface SyncAckDto {
  channelId: string;
  seqId: string;
}
