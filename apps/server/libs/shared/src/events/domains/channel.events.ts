/**
 * 频道相关 WebSocket 事件类型定义
 *
 * @module events/domains/channel
 */

// ==================== 客户端 -> 服务器 ====================

/**
 * 加入频道请求
 *
 * 客户端发送此事件以订阅频道的实时消息。
 * 服务器会验证用户是否为频道成员。
 *
 * @event join_channel
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端
 * socket.emit('join_channel', { channelId: 'channel-uuid' });
 *
 * // 服务器响应
 * // 成功: { success: true }
 * // 失败: { error: 'Not a member of this channel' }
 * ```
 */
export interface JoinChannelPayload {
  /** 要加入的频道 ID */
  channelId: string;
}

/**
 * 离开频道请求
 *
 * 客户端发送此事件以取消订阅频道的实时消息。
 *
 * @event leave_channel
 * @direction Client -> Server
 *
 * @example
 * ```typescript
 * // 客户端
 * socket.emit('leave_channel', { channelId: 'channel-uuid' });
 * ```
 */
export interface LeaveChannelPayload {
  /** 要离开的频道 ID */
  channelId: string;
}

// ==================== 服务器 -> 客户端 ====================

/**
 * 频道已加入事件
 *
 * 当用户加入频道后，服务器广播此事件给频道内其他成员。
 *
 * @event channel_joined
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_joined', (event: ChannelJoinedEvent) => {
 *   console.log(`${event.username} 加入了频道`);
 * });
 * ```
 */
export interface ChannelJoinedEvent {
  /** 频道 ID */
  channelId: string;
  /** 加入的用户 ID */
  userId: string;
  /** 加入的用户名 */
  username: string;
}

/**
 * 频道已离开事件
 *
 * 当用户离开频道后，服务器广播此事件给频道内其他成员。
 *
 * @event channel_left
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_left', (event: ChannelLeftEvent) => {
 *   console.log(`用户 ${event.userId} 离开了频道`);
 * });
 * ```
 */
export interface ChannelLeftEvent {
  /** 频道 ID */
  channelId: string;
  /** 离开的用户 ID */
  userId: string;
}

/**
 * 频道已创建事件
 *
 * 当新频道创建后，服务器发送此事件给相关用户（频道成员或工作空间成员）。
 *
 * @event channel_created
 * @direction Server -> Related Users
 *
 * @example
 * ```typescript
 * socket.on('channel_created', (event: ChannelCreatedEvent) => {
 *   // 将新频道添加到频道列表
 *   addChannel(event);
 * });
 * ```
 */
export interface ChannelCreatedEvent {
  /** 频道 ID */
  id: string;
  /** 租户/工作空间 ID */
  tenantId: string;
  /** 频道名称 */
  name: string;
  /** 频道描述 */
  description?: string;
  /** 频道头像 URL */
  avatarUrl?: string;
  /** 频道类型 */
  type: 'direct' | 'public' | 'private';
  /** 创建者用户 ID */
  createdBy: string;
  /** 是否已归档 */
  isArchived: boolean;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

/**
 * 频道已更新事件
 *
 * 当频道信息（名称、描述等）更新后，服务器广播此事件给频道成员。
 *
 * @event channel_updated
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_updated', (event: ChannelUpdatedEvent) => {
 *   // 更新本地频道信息
 *   updateChannel(event.channelId, event);
 * });
 * ```
 */
export interface ChannelUpdatedEvent {
  /** 频道 ID */
  channelId: string;
  /** 更新后的频道名称 */
  name?: string;
  /** 更新后的频道描述 */
  description?: string;
  /** 更新后的频道头像 */
  avatarUrl?: string;
  /** 执行更新的用户 ID */
  updatedBy: string;
  /** 更新时间 */
  updatedAt: string;
}

/**
 * 频道已删除事件
 *
 * 当频道被删除后，服务器广播此事件给频道成员。
 *
 * @event channel_deleted
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_deleted', (event: ChannelDeletedEvent) => {
 *   // 从频道列表中移除
 *   removeChannel(event.channelId);
 *   // 如果当前在此频道，跳转到其他频道
 *   if (currentChannelId === event.channelId) {
 *     navigateToDefaultChannel();
 *   }
 * });
 * ```
 */
export interface ChannelDeletedEvent {
  /** 被删除的频道 ID */
  channelId: string;
  /** 被删除的频道名称（用于显示通知） */
  channelName?: string;
  /** 执行删除的用户 ID */
  deletedBy: string;
}

/**
 * 频道已归档事件
 *
 * 当频道被归档后，服务器广播此事件给频道成员。
 * 归档的频道仍可查看历史消息，但不能发送新消息。
 *
 * @event channel_archived
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_archived', (event: ChannelArchivedEvent) => {
 *   // 更新频道状态为已归档
 *   setChannelArchived(event.channelId, true);
 * });
 * ```
 */
export interface ChannelArchivedEvent {
  /** 被归档的频道 ID */
  channelId: string;
  /** 被归档的频道名称 */
  channelName?: string;
  /** 执行归档的用户 ID */
  archivedBy: string;
}

/**
 * 频道已取消归档事件
 *
 * 当频道取消归档后，服务器广播此事件给频道成员。
 *
 * @event channel_unarchived
 * @direction Server -> Channel Members
 *
 * @example
 * ```typescript
 * socket.on('channel_unarchived', (event: ChannelUnarchivedEvent) => {
 *   // 更新频道状态为未归档
 *   setChannelArchived(event.channelId, false);
 * });
 * ```
 */
export interface ChannelUnarchivedEvent {
  /** 取消归档的频道 ID */
  channelId: string;
  /** 频道名称 */
  channelName?: string;
  /** 执行操作的用户 ID */
  unarchivedBy: string;
}

// ==================== 响应类型 ====================

/**
 * 加入/离开频道的响应
 */
export interface ChannelOperationResponse {
  /** 操作是否成功 */
  success?: boolean;
  /** 错误信息 */
  error?: string;
}
