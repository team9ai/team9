/**
 * 消息相关 WebSocket 事件类型定义
 *
 * @module events/domains/message
 */

// ==================== 基础消息类型 ====================

/**
 * 消息类型枚举
 */
export type WSMessageType = 'text' | 'file' | 'image' | 'system';

/**
 * 消息发送者信息
 */
export interface MessageSender {
  /** 用户 ID */
  id: string;
  /** 用户名 */
  username: string;
  /** 显示名称 */
  displayName?: string;
  /** 头像 URL */
  avatarUrl?: string;
}

/**
 * 消息附件信息
 */
export interface MessageAttachment {
  /** 附件 ID */
  id: string;
  /** 消息 ID */
  messageId: string;
  /** 文件存储 Key */
  fileKey: string;
  /** 文件名 */
  fileName: string;
  /** 文件 URL */
  fileUrl: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** MIME 类型 */
  mimeType: string;
  /** 缩略图 URL（图片类型） */
  thumbnailUrl?: string;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
  /** 创建时间 */
  createdAt: string;
}

/**
 * 消息反应信息
 */
export interface MessageReaction {
  /** 反应 ID */
  id: string;
  /** 消息 ID */
  messageId: string;
  /** 用户 ID */
  userId: string;
  /** 表情符号 */
  emoji: string;
  /** 创建时间 */
  createdAt: string;
}

// ==================== 服务器 -> 客户端 ====================

/**
 * 新消息事件
 *
 * 当频道内有新消息时，服务器广播此事件给频道成员。
 *
 * @event new_message
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('new_message', (event: NewMessageEvent) => {
 *   // 添加消息到消息列表
 *   addMessage(event);
 *   // 更新未读计数
 *   incrementUnreadCount(event.channelId);
 * });
 * ```
 */
export interface NewMessageEvent {
  /** 消息 ID */
  id: string;
  /** 频道 ID */
  channelId: string;
  /** 发送者用户 ID */
  senderId: string;
  /** 父消息 ID（线程回复） */
  parentId?: string;
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  type: WSMessageType;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
  /** 是否已置顶 */
  isPinned: boolean;
  /** 是否已编辑 */
  isEdited: boolean;
  /** 是否已删除 */
  isDeleted: boolean;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 发送者详细信息 */
  sender?: MessageSender;
  /** 附件列表 */
  attachments?: MessageAttachment[];
  /** 反应列表 */
  reactions?: MessageReaction[];
  /** 回复数量（仅父消息） */
  replyCount?: number;
}

/**
 * 消息已更新事件
 *
 * 当消息被编辑后，服务器广播此事件给频道成员。
 *
 * @event message_updated
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('message_updated', (event: MessageUpdatedEvent) => {
 *   // 更新消息内容
 *   updateMessage(event.id, event);
 * });
 * ```
 */
export interface MessageUpdatedEvent {
  /** 消息 ID */
  id: string;
  /** 频道 ID */
  channelId: string;
  /** 发送者用户 ID */
  senderId: string;
  /** 父消息 ID */
  parentId?: string;
  /** 更新后的消息内容 */
  content: string;
  /** 消息类型 */
  type: WSMessageType;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
  /** 是否已置顶 */
  isPinned: boolean;
  /** 是否已编辑（更新后应为 true） */
  isEdited: boolean;
  /** 是否已删除 */
  isDeleted: boolean;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 发送者详细信息 */
  sender?: MessageSender;
  /** 附件列表 */
  attachments?: MessageAttachment[];
  /** 反应列表 */
  reactions?: MessageReaction[];
  /** 回复数量 */
  replyCount?: number;
}

/**
 * 消息已删除事件
 *
 * 当消息被删除后，服务器广播此事件给频道成员。
 *
 * @event message_deleted
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('message_deleted', (event: MessageDeletedEvent) => {
 *   // 从消息列表中移除或标记为已删除
 *   removeMessage(event.messageId);
 * });
 * ```
 */
export interface MessageDeletedEvent {
  /** 被删除的消息 ID */
  messageId: string;
  /** 频道 ID（可选，便于前端处理） */
  channelId?: string;
}

// ==================== 消息读取状态 ====================

/**
 * 标记已读请求
 *
 * 客户端发送此事件以标记频道消息为已读。
 *
 * @event mark_as_read
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端
 * socket.emit('mark_as_read', {
 *   channelId: 'channel-uuid',
 *   messageId: 'message-uuid'
 * });
 * ```
 */
export interface MarkAsReadPayload {
  /** 频道 ID */
  channelId: string;
  /** 已读到的消息 ID */
  messageId: string;
}

/**
 * 读取状态已更新事件
 *
 * 当用户标记消息已读后，服务器广播此事件给频道其他成员。
 * 用于显示已读回执。
 *
 * @event read_status_updated
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('read_status_updated', (event: ReadStatusUpdatedEvent) => {
 *   // 更新用户的已读位置
 *   updateReadStatus(event.channelId, event.userId, event.lastReadMessageId);
 * });
 * ```
 */
export interface ReadStatusUpdatedEvent {
  /** 频道 ID */
  channelId: string;
  /** 标记已读的用户 ID */
  userId: string;
  /** 最后已读的消息 ID */
  lastReadMessageId: string;
}
