/**
 * 消息反应相关 WebSocket 事件类型定义
 *
 * @module events/domains/reaction
 */

// ==================== 客户端 -> 服务器 ====================

/**
 * 添加反应请求
 *
 * 客户端发送此事件以为消息添加表情反应。
 *
 * @event add_reaction
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端 - 用户点击表情
 * socket.emit('add_reaction', {
 *   messageId: 'message-uuid',
 *   emoji: '👍'
 * });
 * ```
 */
export interface AddReactionPayload {
  /** 消息 ID */
  messageId: string;
  /** 表情符号（Unicode 或 emoji shortcode） */
  emoji: string;
}

/**
 * 移除反应请求
 *
 * 客户端发送此事件以移除消息的表情反应。
 *
 * @event remove_reaction
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端 - 用户取消点击已选择的表情
 * socket.emit('remove_reaction', {
 *   messageId: 'message-uuid',
 *   emoji: '👍'
 * });
 * ```
 */
export interface RemoveReactionPayload {
  /** 消息 ID */
  messageId: string;
  /** 要移除的表情符号 */
  emoji: string;
}

// ==================== 服务器 -> 客户端 ====================

/**
 * 反应已添加事件
 *
 * 当用户为消息添加反应后，服务器广播此事件给频道所有成员。
 *
 * @event reaction_added
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('reaction_added', (event: ReactionAddedEvent) => {
 *   // 更新消息的反应列表
 *   addReactionToMessage(event.messageId, {
 *     userId: event.userId,
 *     emoji: event.emoji
 *   });
 * });
 * ```
 */
export interface ReactionAddedEvent {
  /** 消息 ID */
  messageId: string;
  /** 添加反应的用户 ID */
  userId: string;
  /** 添加的表情符号 */
  emoji: string;
}

/**
 * 反应已移除事件
 *
 * 当用户移除消息反应后，服务器广播此事件给频道所有成员。
 *
 * @event reaction_removed
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('reaction_removed', (event: ReactionRemovedEvent) => {
 *   // 从消息的反应列表中移除
 *   removeReactionFromMessage(event.messageId, {
 *     userId: event.userId,
 *     emoji: event.emoji
 *   });
 * });
 * ```
 */
export interface ReactionRemovedEvent {
  /** 消息 ID */
  messageId: string;
  /** 移除反应的用户 ID */
  userId: string;
  /** 被移除的表情符号 */
  emoji: string;
}

// ==================== 响应类型 ====================

/**
 * 反应操作响应
 */
export interface ReactionOperationResponse {
  /** 操作是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}
