/**
 * 打字状态相关 WebSocket 事件类型定义
 *
 * @module events/domains/typing
 */

// ==================== 客户端 -> 服务器 ====================

/**
 * 开始打字请求
 *
 * 客户端发送此事件以通知其他用户当前用户正在输入。
 * 服务器会在 Redis 中设置 5 秒 TTL 的打字状态。
 *
 * @event typing_start
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端 - 当用户开始输入时
 * socket.emit('typing_start', { channelId: 'channel-uuid' });
 * ```
 */
export interface TypingStartPayload {
  /** 正在输入的频道 ID */
  channelId: string;
}

/**
 * 停止打字请求
 *
 * 客户端发送此事件以通知其他用户当前用户停止输入。
 *
 * @event typing_stop
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端 - 当用户停止输入或发送消息后
 * socket.emit('typing_stop', { channelId: 'channel-uuid' });
 * ```
 */
export interface TypingStopPayload {
  /** 停止输入的频道 ID */
  channelId: string;
}

// ==================== 服务器 -> 客户端 ====================

/**
 * 用户正在打字事件
 *
 * 当用户开始或停止打字时，服务器广播此事件给频道其他成员。
 *
 * @event user_typing
 * @direction Server -> Channel Members (excluding sender)
 *
 * @example
 * ```typescript
 * socket.on('user_typing', (event: UserTypingEvent) => {
 *   if (event.isTyping) {
 *     // 显示 "xxx 正在输入..."
 *     showTypingIndicator(event.channelId, event.username);
 *   } else {
 *     // 隐藏打字指示器
 *     hideTypingIndicator(event.channelId, event.userId);
 *   }
 * });
 * ```
 */
export interface UserTypingEvent {
  /** 频道 ID */
  channelId: string;
  /** 正在打字的用户 ID */
  userId: string;
  /** 正在打字的用户名 */
  username: string;
  /** 是否正在打字 */
  isTyping: boolean;
}

// ==================== 响应类型 ====================

/**
 * 打字状态操作响应
 */
export interface TypingOperationResponse {
  /** 操作是否成功 */
  success: boolean;
}
