/**
 * 系统相关 WebSocket 事件类型定义
 *
 * 包括心跳、消息确认、会话管理、消息同步等系统级事件。
 *
 * @module events/domains/system
 */

// ==================== 心跳事件 ====================

/**
 * 心跳请求
 *
 * 客户端定期发送此事件以保持连接活跃并检测网络状态。
 *
 * @event ping
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端 - 每 30 秒发送一次心跳
 * setInterval(() => {
 *   socket.emit('ping', { timestamp: Date.now() });
 * }, 30000);
 * ```
 */
export interface PingPayload {
  /** 客户端发送时间戳（毫秒） */
  timestamp: number;
}

/**
 * 心跳响应
 *
 * 服务器收到心跳请求后返回此事件。
 *
 * @event pong
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('pong', (event: PongEvent) => {
 *   const latency = Date.now() - event.timestamp;
 *   console.log(`网络延迟: ${latency}ms`);
 * });
 * ```
 */
export interface PongEvent {
  /** 事件类型标识 */
  type: 'pong';
  /** 原始客户端时间戳（回显） */
  timestamp: number;
  /** 服务器当前时间戳 */
  serverTime: number;
}

// ==================== 消息确认事件 ====================

/**
 * 消息确认类型
 */
export type MessageAckType = 'delivered' | 'read';

/**
 * 消息确认请求
 *
 * 客户端发送此事件以确认消息已送达或已读。
 * 服务器会将确认信息转发给 IM Worker 服务处理。
 *
 * @event message_ack
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端 - 消息渲染到屏幕后
 * socket.emit('message_ack', {
 *   msgId: 'message-uuid',
 *   ackType: 'delivered'
 * });
 *
 * // 客户端 - 用户查看消息后
 * socket.emit('message_ack', {
 *   msgId: 'message-uuid',
 *   ackType: 'read'
 * });
 * ```
 */
export interface MessageAckPayload {
  /** 消息 ID */
  msgId: string;
  /** 确认类型 */
  ackType: MessageAckType;
}

/**
 * 消息确认响应
 *
 * 服务器收到消息确认后返回此事件。
 *
 * @event message_ack_response
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('message_ack_response', (event: MessageAckResponseEvent) => {
 *   console.log(`消息 ${event.msgId} 确认状态: ${event.status}`);
 * });
 * ```
 */
export interface MessageAckResponseEvent {
  /** 消息 ID */
  msgId: string;
  /** 确认状态 */
  status: 'received' | 'error';
  /** 错误信息（当 status 为 error 时） */
  error?: string;
}

/**
 * 消息已发送确认事件
 *
 * 当消息成功持久化后，服务器发送此事件给发送者。
 * 包含服务器分配的消息序列号。
 *
 * @event message_sent
 * @direction Server -> Sender
 *
 * @example
 * ```typescript
 * socket.on('message_sent', (event: MessageSentEvent) => {
 *   // 更新本地消息状态为已发送
 *   updateMessageStatus(event.clientMsgId, 'sent', event.seqId);
 * });
 * ```
 */
export interface MessageSentEvent {
  /** 服务器生成的消息 ID */
  msgId: string;
  /** 客户端生成的消息 ID（用于匹配本地消息） */
  clientMsgId?: string;
  /** 消息序列号（用于排序） */
  seqId: string;
  /** 服务器时间戳 */
  serverTime: number;
}

// ==================== 会话管理事件 ====================

/**
 * 会话过期事件
 *
 * 当用户的认证 token 过期后，服务器发送此事件。
 *
 * @event session_expired
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('session_expired', (event: SessionExpiredEvent) => {
 *   // 清理本地状态
 *   clearAuthState();
 *   // 跳转到登录页
 *   navigateToLogin(event.reason);
 * });
 * ```
 */
export interface SessionExpiredEvent {
  /** 过期原因 */
  reason: string;
  /** 过期时间 */
  expiredAt?: string;
}

/**
 * 会话超时事件
 *
 * 当心跳超时导致会话失效时，服务器发送此事件。
 *
 * @event session_timeout
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('session_timeout', (event: SessionTimeoutEvent) => {
 *   // 尝试重新连接
 *   reconnect();
 * });
 * ```
 */
export interface SessionTimeoutEvent {
  /** 超时原因 */
  reason: string;
  /** 最后活跃时间 */
  lastActiveAt?: string;
}

/**
 * 被其他设备踢出事件
 *
 * 当同一账号在其他设备登录导致当前设备被踢出时，服务器发送此事件。
 *
 * @event session_kicked
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('session_kicked', (event: SessionKickedEvent) => {
 *   showAlert(`您的账号在其他设备 (${event.newDeviceInfo?.platform}) 上登录`);
 *   // 断开连接并跳转到登录页
 *   disconnect();
 *   navigateToLogin();
 * });
 * ```
 */
export interface SessionKickedEvent {
  /** 踢出原因 */
  reason: string;
  /** 新设备信息 */
  newDeviceInfo?: {
    platform: string;
    version?: string;
  };
}

// ==================== 消息同步事件 ====================

/**
 * 同步消息请求
 *
 * 客户端发送此事件以请求同步离线期间的消息。
 *
 * @event sync_messages
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端 - 重新连接后
 * socket.emit('sync_messages', {
 *   channelId: 'channel-uuid',
 *   lastMessageId: 'last-known-message-uuid',
 *   limit: 50
 * });
 * ```
 */
export interface SyncMessagesPayload {
  /** 频道 ID（可选，不指定则同步所有频道） */
  channelId?: string;
  /** 最后已知的消息 ID（从此消息之后开始同步） */
  lastMessageId?: string;
  /** 最大同步消息数量 */
  limit?: number;
}

/**
 * 同步消息响应
 *
 * 服务器返回请求的离线消息。
 *
 * @event sync_messages_response
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('sync_messages_response', (event: SyncMessagesResponseEvent) => {
 *   // 将同步的消息添加到本地存储
 *   for (const msg of event.messages) {
 *     addMessage(msg);
 *   }
 *   // 如果还有更多消息，继续同步
 *   if (event.hasMore) {
 *     requestMoreMessages(event.channelId, event.messages.at(-1)?.id);
 *   }
 * });
 * ```
 */
export interface SyncMessagesResponseEvent {
  /** 频道 ID */
  channelId?: string;
  /** 同步的消息列表 */
  messages: Array<{
    id: string;
    channelId: string;
    senderId: string;
    content: string;
    type: string;
    createdAt: string;
    [key: string]: unknown;
  }>;
  /** 是否还有更多消息 */
  hasMore: boolean;
}

/**
 * 消息重试事件
 *
 * 当消息投递失败后，服务器请求客户端重试。
 *
 * @event message_retry
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * socket.on('message_retry', (event: MessageRetryEvent) => {
 *   // 找到本地待发送的消息
 *   const pendingMessage = getPendingMessage(event.clientMsgId);
 *   if (pendingMessage) {
 *     // 重新发送
 *     resendMessage(pendingMessage);
 *   }
 * });
 * ```
 */
export interface MessageRetryEvent {
  /** 客户端消息 ID */
  clientMsgId: string;
  /** 重试原因 */
  reason: string;
  /** 当前重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
}

// ==================== 提及通知事件 ====================

/**
 * 提及类型
 */
export type MentionType = 'user' | 'channel' | 'everyone' | 'here';

/**
 * 收到提及事件
 *
 * 当用户在消息中被 @提及 时，服务器发送此事件给被提及的用户。
 *
 * @event mention_received
 * @direction Server -> Mentioned User
 *
 * @example
 * ```typescript
 * socket.on('mention_received', (event: MentionReceivedEvent) => {
 *   // 显示提及通知
 *   showMentionNotification(event);
 *   // 更新提及未读计数
 *   incrementMentionCount(event.channelId);
 * });
 * ```
 */
export interface MentionReceivedEvent {
  /** 提及 ID */
  mentionId: string;
  /** 消息 ID */
  messageId: string;
  /** 频道 ID */
  channelId: string;
  /** 提及类型 */
  type: MentionType;
  /** 发送消息的用户 ID */
  senderId: string;
  /** 发送消息的用户名 */
  senderUsername: string;
  /** 消息内容预览 */
  messagePreview: string;
  /** 创建时间 */
  createdAt: string;
}
