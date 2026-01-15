/**
 * 认证相关 WebSocket 事件类型定义
 *
 * @module events/domains/auth
 */

// ==================== 服务器 -> 客户端 ====================

/**
 * 认证成功事件
 *
 * 当用户 WebSocket 连接认证成功后，服务器发送此事件给客户端。
 *
 * @event authenticated
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * // 服务器端
 * client.emit(WS_EVENTS.AUTH.AUTHENTICATED, { userId: user.id });
 *
 * // 客户端
 * socket.on('authenticated', (event: AuthenticatedEvent) => {
 *   console.log('认证成功，用户ID:', event.userId);
 * });
 * ```
 */
export interface AuthenticatedEvent {
  /** 认证成功的用户 ID */
  userId: string;
}

/**
 * 认证错误事件
 *
 * 当用户 WebSocket 连接认证失败后，服务器发送此事件给客户端。
 * 发送后服务器会主动断开连接。
 *
 * @event auth_error
 * @direction Server -> Client
 *
 * @example
 * ```typescript
 * // 服务器端
 * client.emit(WS_EVENTS.AUTH.AUTH_ERROR, { message: 'Token expired' });
 * client.disconnect();
 *
 * // 客户端
 * socket.on('auth_error', (event: AuthErrorEvent) => {
 *   console.error('认证失败:', event.message);
 *   // 可能需要重新登录
 * });
 * ```
 */
export interface AuthErrorEvent {
  /** 错误信息 */
  message: string;
}
