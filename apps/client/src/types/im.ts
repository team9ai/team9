// IM Types matching gateway API

export type ChannelType = "direct" | "public" | "private";
export type MessageType = "text" | "file" | "image" | "system";
export type MemberRole = "owner" | "admin" | "member";
export type UserStatus = "online" | "offline" | "away" | "busy";

export interface IMUser {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  status: UserStatus;
  lastSeenAt?: string;
  isActive: boolean;
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
  isArchived: boolean;
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
  };
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
  senderId: string;
  parentId?: string;
  content: string;
  type: MessageType;
  metadata?: Record<string, any>;
  isPinned: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  sender?: IMUser;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  replyCount?: number;
}

export interface Mention {
  id: string;
  messageId: string;
  mentionedUserId?: string;
  mentionedChannelId?: string;
  type: "user" | "channel" | "everyone" | "here";
  isRead: boolean;
  createdAt: string;
  message?: Message;
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
}

export interface AttachmentDto {
  fileKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface CreateMessageDto {
  content: string;
  parentId?: string;
  attachments?: AttachmentDto[];
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
}

export interface SearchUsersParams {
  q: string;
  limit?: number;
}

// WebSocket event types
export interface WSMessage {
  channelId: string;
  content: string;
  parentId?: string;
}

export interface WSMarkAsRead {
  channelId: string;
  messageId: string;
}

export interface WSTyping {
  channelId: string;
}

export interface WSReaction {
  messageId: string;
  emoji: string;
}

export interface WSUserTyping {
  channelId: string;
  userId: string;
  username: string;
  isTyping: boolean;
}

export interface WSChannelEvent {
  channelId: string;
}
