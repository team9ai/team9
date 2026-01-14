/**
 * WebSocket 事件名称常量
 *
 * 按功能域分组的所有 WebSocket 事件名称。
 * 使用 `as const` 确保类型推断为字面量类型。
 *
 * @example
 * ```typescript
 * import { WS_EVENTS } from '@team9/shared';
 *
 * // 服务器端
 * client.emit(WS_EVENTS.AUTH.AUTHENTICATED, { userId });
 *
 * // 客户端
 * socket.on(WS_EVENTS.MESSAGE.NEW, (message) => { ... });
 * ```
 */
export const WS_EVENTS = {
  // ==================== 连接相关 ====================
  /**
   * Socket.io 内置连接事件
   */
  CONNECTION: {
    /** 连接建立 */
    CONNECT: 'connection',
    /** 连接断开 */
    DISCONNECT: 'disconnect',
    /** 连接错误 */
    ERROR: 'error',
  },

  // ==================== 认证相关 ====================
  /**
   * 用户认证事件
   */
  AUTH: {
    /** 认证请求 - 客户端发送 */
    AUTHENTICATE: 'authenticate',
    /** 认证成功 - 服务器发送 */
    AUTHENTICATED: 'authenticated',
    /** 认证失败 - 服务器发送 */
    AUTH_ERROR: 'auth_error',
  },

  // ==================== 频道操作 ====================
  /**
   * 频道相关事件
   */
  CHANNEL: {
    /** 加入频道 - 客户端发送 */
    JOIN: 'join_channel',
    /** 离开频道 - 客户端发送 */
    LEAVE: 'leave_channel',
    /** 频道已加入 - 服务器广播 */
    JOINED: 'channel_joined',
    /** 频道已离开 - 服务器广播 */
    LEFT: 'channel_left',
    /** 频道已创建 - 服务器广播 */
    CREATED: 'channel_created',
    /** 频道已更新 - 服务器广播 */
    UPDATED: 'channel_updated',
    /** 频道已删除 - 服务器广播 */
    DELETED: 'channel_deleted',
    /** 频道已归档 - 服务器广播 */
    ARCHIVED: 'channel_archived',
    /** 频道已取消归档 - 服务器广播 */
    UNARCHIVED: 'channel_unarchived',
  },

  // ==================== 消息操作 ====================
  /**
   * 消息相关事件
   */
  MESSAGE: {
    /** 新消息 - 服务器广播 */
    NEW: 'new_message',
    /** 消息已更新 - 服务器广播 */
    UPDATED: 'message_updated',
    /** 消息已删除 - 服务器广播 */
    DELETED: 'message_deleted',
  },

  // ==================== 读取状态 ====================
  /**
   * 消息读取状态事件
   */
  READ_STATUS: {
    /** 标记已读 - 客户端发送 */
    MARK_AS_READ: 'mark_as_read',
    /** 读取状态已更新 - 服务器广播 */
    UPDATED: 'read_status_updated',
  },

  // ==================== 打字状态 ====================
  /**
   * 打字指示器事件
   */
  TYPING: {
    /** 开始打字 - 客户端发送 */
    START: 'typing_start',
    /** 停止打字 - 客户端发送 */
    STOP: 'typing_stop',
    /** 用户正在打字 - 服务器广播 */
    USER_TYPING: 'user_typing',
  },

  // ==================== 用户状态 ====================
  /**
   * 用户在线状态事件
   */
  USER: {
    /** 用户上线 - 服务器广播 */
    ONLINE: 'user_online',
    /** 用户离线 - 服务器广播 */
    OFFLINE: 'user_offline',
    /** 用户状态变更 - 服务器广播 */
    STATUS_CHANGED: 'user_status_changed',
  },

  // ==================== 消息反应 ====================
  /**
   * 消息表情反应事件
   */
  REACTION: {
    /** 添加反应 - 客户端发送 */
    ADD: 'add_reaction',
    /** 移除反应 - 客户端发送 */
    REMOVE: 'remove_reaction',
    /** 反应已添加 - 服务器广播 */
    ADDED: 'reaction_added',
    /** 反应已移除 - 服务器广播 */
    REMOVED: 'reaction_removed',
  },

  // ==================== 提及通知 ====================
  /**
   * @提及 通知事件
   */
  MENTION: {
    /** 收到提及 - 服务器发送给被提及用户 */
    RECEIVED: 'mention_received',
  },

  // ==================== 工作空间 ====================
  /**
   * 工作空间相关事件
   */
  WORKSPACE: {
    /** 加入工作空间 - 客户端发送 */
    JOIN: 'join_workspace',
    /** 工作空间成员列表 - 服务器发送 */
    MEMBERS_LIST: 'workspace_members_list',
    /** 成员加入 - 服务器广播 */
    MEMBER_JOINED: 'workspace_member_joined',
    /** 成员离开 - 服务器广播 */
    MEMBER_LEFT: 'workspace_member_left',
    /** 成员被移除 - 服务器广播 */
    MEMBER_REMOVED: 'workspace_member_removed',
  },

  // ==================== 系统事件 ====================
  /**
   * 心跳和系统事件
   */
  SYSTEM: {
    /** 心跳请求 - 客户端发送 */
    PING: 'ping',
    /** 心跳响应 - 服务器返回 */
    PONG: 'pong',
    /** 消息确认 - 客户端发送 */
    MESSAGE_ACK: 'message_ack',
    /** 消息确认响应 - 服务器返回 */
    MESSAGE_ACK_RESPONSE: 'message_ack_response',
    /** 消息已发送确认 - 服务器发送 */
    MESSAGE_SENT: 'message_sent',
  },

  // ==================== 会话管理 ====================
  /**
   * 会话状态事件
   */
  SESSION: {
    /** 会话过期 */
    EXPIRED: 'session_expired',
    /** 会话超时 */
    TIMEOUT: 'session_timeout',
    /** 被其他设备踢出 */
    KICKED: 'session_kicked',
  },

  // ==================== 消息同步 ====================
  /**
   * 离线消息同步事件
   */
  SYNC: {
    /** 请求同步消息 - 客户端发送 */
    MESSAGES: 'sync_messages',
    /** 同步响应 - 服务器返回 */
    MESSAGES_RESPONSE: 'sync_messages_response',
    /** 消息重试 - 服务器发送 */
    MESSAGE_RETRY: 'message_retry',
  },
} as const;

/**
 * 所有 WebSocket 事件名称的联合类型
 */
export type WsEventName =
  | (typeof WS_EVENTS.CONNECTION)[keyof typeof WS_EVENTS.CONNECTION]
  | (typeof WS_EVENTS.AUTH)[keyof typeof WS_EVENTS.AUTH]
  | (typeof WS_EVENTS.CHANNEL)[keyof typeof WS_EVENTS.CHANNEL]
  | (typeof WS_EVENTS.MESSAGE)[keyof typeof WS_EVENTS.MESSAGE]
  | (typeof WS_EVENTS.READ_STATUS)[keyof typeof WS_EVENTS.READ_STATUS]
  | (typeof WS_EVENTS.TYPING)[keyof typeof WS_EVENTS.TYPING]
  | (typeof WS_EVENTS.USER)[keyof typeof WS_EVENTS.USER]
  | (typeof WS_EVENTS.REACTION)[keyof typeof WS_EVENTS.REACTION]
  | (typeof WS_EVENTS.MENTION)[keyof typeof WS_EVENTS.MENTION]
  | (typeof WS_EVENTS.WORKSPACE)[keyof typeof WS_EVENTS.WORKSPACE]
  | (typeof WS_EVENTS.SYSTEM)[keyof typeof WS_EVENTS.SYSTEM]
  | (typeof WS_EVENTS.SESSION)[keyof typeof WS_EVENTS.SESSION]
  | (typeof WS_EVENTS.SYNC)[keyof typeof WS_EVENTS.SYNC];
