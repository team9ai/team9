/**
 * Message related WebSocket event type definitions
 *
 * @module events/domains/message
 */

// ==================== Base Message Types ====================

/**
 * Message type enumeration
 */
export type WSMessageType = 'text' | 'file' | 'image' | 'system';

/**
 * Message sender information
 */
export interface MessageSender {
  /** User ID */
  id: string;
  /** Username */
  username: string;
  /** Display name */
  displayName?: string;
  /** Avatar URL */
  avatarUrl?: string;
}

/**
 * Message attachment information
 */
export interface MessageAttachment {
  /** Attachment ID */
  id: string;
  /** Message ID */
  messageId: string;
  /** File storage key */
  fileKey: string;
  /** File name */
  fileName: string;
  /** File URL */
  fileUrl: string;
  /** File size (bytes) */
  fileSize: number;
  /** MIME type */
  mimeType: string;
  /** Thumbnail URL (for images) */
  thumbnailUrl?: string;
  /** Image width */
  width?: number;
  /** Image height */
  height?: number;
  /** Created at */
  createdAt: string;
}

/**
 * Message reaction information
 */
export interface MessageReaction {
  /** Reaction ID */
  id: string;
  /** Message ID */
  messageId: string;
  /** User ID */
  userId: string;
  /** Emoji */
  emoji: string;
  /** Created at */
  createdAt: string;
}

// ==================== Server -> Client ====================

/**
 * New message event
 *
 * Broadcast by the server to channel members when there's a new message in the channel.
 *
 * @event new_message
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('new_message', (event: NewMessageEvent) => {
 *   // Add message to message list
 *   addMessage(event);
 *   // Update unread count
 *   incrementUnreadCount(event.channelId);
 * });
 * ```
 */
export interface NewMessageEvent {
  /** Message ID */
  id: string;
  /** Channel ID */
  channelId: string;
  /** Sender user ID (null for system messages) */
  senderId: string | null;
  /** Parent message ID (direct parent for replies) */
  parentId?: string;
  /** Root message ID (thread root, for efficient querying) */
  rootId?: string;
  /** Message content */
  content: string;
  /** Message type */
  type: WSMessageType;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Whether pinned */
  isPinned: boolean;
  /** Whether edited */
  isEdited: boolean;
  /** Whether deleted */
  isDeleted: boolean;
  /** Created at */
  createdAt: string;
  /** Updated at */
  updatedAt: string;
  /** Sender details */
  sender?: MessageSender;
  /** Attachments list */
  attachments?: MessageAttachment[];
  /** Reactions list */
  reactions?: MessageReaction[];
  /** Reply count (parent messages only) */
  replyCount?: number;
}

/**
 * Message updated event
 *
 * Broadcast by the server to channel members when a message is edited.
 *
 * @event message_updated
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('message_updated', (event: MessageUpdatedEvent) => {
 *   // Update message content
 *   updateMessage(event.id, event);
 * });
 * ```
 */
export interface MessageUpdatedEvent {
  /** Message ID */
  id: string;
  /** Channel ID */
  channelId: string;
  /** Sender user ID */
  senderId: string;
  /** Parent message ID (direct parent for replies) */
  parentId?: string;
  /** Root message ID (thread root) */
  rootId?: string;
  /** Updated message content */
  content: string;
  /** Message type */
  type: WSMessageType;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Whether pinned */
  isPinned: boolean;
  /** Whether edited (should be true after update) */
  isEdited: boolean;
  /** Whether deleted */
  isDeleted: boolean;
  /** Created at */
  createdAt: string;
  /** Updated at */
  updatedAt: string;
  /** Sender details */
  sender?: MessageSender;
  /** Attachments list */
  attachments?: MessageAttachment[];
  /** Reactions list */
  reactions?: MessageReaction[];
  /** Reply count */
  replyCount?: number;
}

/**
 * Message deleted event
 *
 * Broadcast by the server to channel members when a message is deleted.
 *
 * @event message_deleted
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('message_deleted', (event: MessageDeletedEvent) => {
 *   // Remove from message list or mark as deleted
 *   removeMessage(event.messageId);
 * });
 * ```
 */
export interface MessageDeletedEvent {
  /** Deleted message ID */
  messageId: string;
  /** Channel ID (optional, for frontend convenience) */
  channelId?: string;
}

// ==================== Message Read Status ====================

/**
 * Mark as read request
 *
 * Sent by the client to mark channel messages as read.
 *
 * @event mark_as_read
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // Client side
 * socket.emit('mark_as_read', {
 *   channelId: 'channel-uuid',
 *   messageId: 'message-uuid'
 * });
 * ```
 */
export interface MarkAsReadPayload {
  /** Channel ID */
  channelId: string;
  /** Message ID read up to */
  messageId: string;
}

/**
 * Read status updated event
 *
 * Broadcast by the server to other channel members when a user marks messages as read.
 * Used to display read receipts.
 *
 * @event read_status_updated
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('read_status_updated', (event: ReadStatusUpdatedEvent) => {
 *   // Update user's read position
 *   updateReadStatus(event.channelId, event.userId, event.lastReadMessageId);
 * });
 * ```
 */
export interface ReadStatusUpdatedEvent {
  /** Channel ID */
  channelId: string;
  /** User ID who marked as read */
  userId: string;
  /** Last read message ID */
  lastReadMessageId: string;
}
