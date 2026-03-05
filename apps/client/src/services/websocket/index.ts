import { io, Socket } from "socket.io-client";
import * as Sentry from "@sentry/react";
import { queryClient } from "@/lib/query-client";
import {
  WS_EVENTS,
  type MarkAsReadPayload,
  type TypingStartPayload,
  type AddReactionPayload,
  type NewMessageEvent,
  type MessageUpdatedEvent,
  type MessageDeletedEvent,
  type UserTypingEvent,
  type ReadStatusUpdatedEvent,
  type ChannelJoinedEvent,
  type ChannelLeftEvent,
  type ChannelCreatedEvent,
  type ChannelUpdatedEvent,
  type ChannelDeletedEvent,
  type ChannelArchivedEvent,
  type ChannelUnarchivedEvent,
  type UserOnlineEvent,
  type UserOfflineEvent,
  type UserStatusChangedEvent,
  type ReactionAddedEvent,
  type ReactionRemovedEvent,
  type WorkspaceMemberJoinedEvent,
  type WorkspaceMemberLeftEvent,
  type WorkspaceMemberRemovedEvent,
  type NotificationNewEvent,
  type NotificationCountsUpdatedEvent,
  type NotificationReadEvent,
  type StreamingStartEvent,
  type StreamingContentEvent,
  type StreamingThinkingContentEvent,
  type StreamingEndEvent,
  type StreamingAbortEvent,
} from "@/types/ws-events";

type EventCallback = (...args: any[]) => void;

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
type ConnectionChangeCallback = (status: ConnectionStatus) => void;

class WebSocketService {
  private static readonly BASE_AUTH_RETRY_DELAY_MS = 1000;
  private static readonly MAX_AUTH_RETRY_DELAY_MS = 30000;
  private static readonly MAX_AUTH_RETRIES = 8;

  private socket: Socket | null = null;
  private isConnecting = false;
  private authErrorRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private authErrorRetryCount = 0;
  // Queue for channels to join when connection is established
  private pendingChannelJoins: Set<string> = new Set();
  // Queue for event listeners to register when connection is established
  private pendingListeners: Array<{ event: string; callback: EventCallback }> =
    [];
  // Connection status observers
  private connectionChangeCallbacks: Set<ConnectionChangeCallback> = new Set();
  private _connectionStatus: ConnectionStatus = "disconnected";

  constructor() {
    // Auto-connect if token exists
    if (this.hasAuthToken()) {
      this.connect();
    }

    if (typeof window !== "undefined") {
      // Reconnect or refresh when browser comes back online
      window.addEventListener("online", () => {
        if (!this.socket?.connected) {
          this.connect();
        } else {
          this.refreshQueriesAfterReconnect();
        }
      });

      // Reconnect or refresh when tab becomes visible again
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (!this.socket?.connected) {
          this.connect();
        } else {
          this.refreshQueriesAfterReconnect();
        }
      });
    }
  }

  private hasAuthToken(): boolean {
    return !!localStorage.getItem("auth_token");
  }

  private getAuthToken(): string | null {
    return localStorage.getItem("auth_token");
  }

  connect(): void {
    if (this.socket?.connected || this.isConnecting) {
      console.log("[WS] Already connected or connecting");
      return;
    }

    const token = this.getAuthToken();
    if (!token) {
      console.error("[WS] No auth token available");
      this.setConnectionStatus("disconnected");
      return;
    }

    // Clean up any existing socket that may be in a disconnected-but-reconnecting
    // state. Without this, the old socket (with reconnection: true) keeps
    // auto-reconnecting in the background as an orphan, each reconnection
    // independently triggering refreshQueriesAfterReconnect().
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.isConnecting = true;
    this.setConnectionStatus("reconnecting");

    // Remove /api suffix from baseURL for WebSocket connection
    let baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
    baseURL = baseURL.replace(/\/api\/?$/, "");

    console.log("[WS] Connecting to:", `${baseURL}/im`);

    this.socket = io(`${baseURL}/im`, {
      // Always use latest token on each (re)connect attempt.
      auth: (cb) => {
        cb({ token: this.getAuthToken() });
      },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      console.log("[WS] Connected successfully");
      this.isConnecting = false;
      if (this.authErrorRetryTimer) {
        clearTimeout(this.authErrorRetryTimer);
        this.authErrorRetryTimer = null;
      }
      this.authErrorRetryCount = 0;
      this.setConnectionStatus("connected");
      Sentry.addBreadcrumb({
        category: "websocket",
        message: "WebSocket connected",
        level: "info",
      });
      // Process pending channel joins
      this.processPendingJoins();
      // Process pending event listeners
      this.processPendingListeners();
    });

    this.socket.on("disconnect", (reason) => {
      console.log("[WS] Disconnected:", reason);
      this.isConnecting = false;
      this.setConnectionStatus("reconnecting");
      Sentry.addBreadcrumb({
        category: "websocket",
        message: `WebSocket disconnected: ${reason}`,
        level: "warning",
      });
    });

    this.socket.on("connect_error", (error) => {
      console.error("[WS] Connection error:", error);
      this.isConnecting = false;
      this.setConnectionStatus("reconnecting");
      Sentry.captureException(error, {
        tags: { type: "websocket", event: "connect_error" },
      });
    });

    this.socket.on("authenticated", () => {
      console.log("[WS] Authenticated successfully");
      this.refreshQueriesAfterReconnect();
    });

    // Auto-join new channels when they are created (e.g., DM channels)
    this.socket.on("channel_created", (channel: { id: string }) => {
      console.log("[WS] New channel created, joining:", channel.id);
      this.joinChannel(channel.id);
    });

    this.socket.on("auth_error", (error) => {
      console.error("[WS] Authentication error:", error);
      Sentry.captureException(
        new Error(`WebSocket auth error: ${JSON.stringify(error)}`),
        { tags: { type: "websocket", event: "auth_error" } },
      );
      // Server disconnected this socket for auth failure. Close local socket and
      // retry shortly, so a freshly refreshed token can be picked up.
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      this.isConnecting = false;
      this.authErrorRetryCount++;
      if (this.authErrorRetryCount > WebSocketService.MAX_AUTH_RETRIES) {
        console.error("[WS] Max auth retries reached, giving up");
        this.authErrorRetryCount = 0;
        this.setConnectionStatus("disconnected");
        return;
      }
      this.setConnectionStatus("reconnecting");
      if (this.authErrorRetryTimer) {
        clearTimeout(this.authErrorRetryTimer);
      }
      const retryDelay = Math.min(
        WebSocketService.BASE_AUTH_RETRY_DELAY_MS *
          2 ** (this.authErrorRetryCount - 1),
        WebSocketService.MAX_AUTH_RETRY_DELAY_MS,
      );
      console.warn(
        `[WS] Auth retry #${this.authErrorRetryCount}, retrying in ${Math.round(retryDelay / 1000)}s`,
      );
      this.authErrorRetryTimer = setTimeout(() => {
        this.authErrorRetryTimer = null;
        if (!this.socket?.connected && this.hasAuthToken()) {
          this.connect();
        }
      }, retryDelay);
    });

    this.socket.on("reconnect", () => {
      // Also refresh on reconnect in case authenticated event doesn't fire
      this.refreshQueriesAfterReconnect();
    });
  }

  disconnect(): void {
    if (this.authErrorRetryTimer) {
      clearTimeout(this.authErrorRetryTimer);
      this.authErrorRetryTimer = null;
    }
    if (this.refreshQueryTimer) {
      clearTimeout(this.refreshQueryTimer);
      this.refreshQueryTimer = null;
    }
    if (this.socket) {
      console.log("[WS] Disconnecting...");
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnecting = false;
    this.authErrorRetryCount = 0;
    this.setConnectionStatus("disconnected");
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  get connectionStatus(): ConnectionStatus {
    return this._connectionStatus;
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    if (this._connectionStatus === status) return;
    this._connectionStatus = status;
    for (const cb of this.connectionChangeCallbacks) {
      try {
        cb(status);
      } catch {
        // ignore callback errors
      }
    }
  }

  onConnectionChange(callback: ConnectionChangeCallback): () => void {
    this.connectionChangeCallbacks.add(callback);
    return () => {
      this.connectionChangeCallbacks.delete(callback);
    };
  }

  private refreshQueryTimer: ReturnType<typeof setTimeout> | null = null;

  private refreshQueriesAfterReconnect(): void {
    // Debounce: both `authenticated` and `reconnect` events can fire in quick
    // succession, and visibilitychange / online handlers may also call this.
    // A single refresh after the dust settles is sufficient.
    if (this.refreshQueryTimer) clearTimeout(this.refreshQueryTimer);
    this.refreshQueryTimer = setTimeout(() => {
      this.refreshQueryTimer = null;
      // Use invalidateQueries (mark stale → refetch if active) instead of
      // refetchQueries (force refetch). This lets React Query deduplicate
      // with concurrent invalidateChannels() calls from useWebSocketEvents.
      queryClient.invalidateQueries({ queryKey: ["channels"], type: "active" });
      queryClient.invalidateQueries({
        queryKey: ["publicChannels"],
        type: "active",
      });
      queryClient.invalidateQueries({ queryKey: ["messages"], type: "active" });
      queryClient.invalidateQueries({
        queryKey: ["im-users", "online"],
      });
    }, 500);
  }

  private processPendingJoins(): void {
    if (!this.socket?.connected) return;
    for (const channelId of this.pendingChannelJoins) {
      console.log("[WS] Processing pending join for channel:", channelId);
      this.socket.emit("join_channel", { channelId });
    }
    this.pendingChannelJoins.clear();
  }

  private processPendingListeners(): void {
    if (!this.socket) return;
    for (const { event, callback } of this.pendingListeners) {
      console.log("[WS] Processing pending listener for event:", event);
      this.socket.on(event, callback);
    }
    this.pendingListeners = [];
  }

  // Channel operations
  joinChannel(channelId: string): void {
    if (!this.socket?.connected) {
      console.log("[WS] Queuing channel join for:", channelId);
      this.pendingChannelJoins.add(channelId);
      return;
    }
    console.log("[WS] Joining channel:", channelId);
    this.socket.emit("join_channel", { channelId });
  }

  leaveChannel(channelId: string): void {
    // Remove from pending joins if not yet connected
    this.pendingChannelJoins.delete(channelId);
    if (!this.socket) return;
    console.log("[WS] Leaving channel:", channelId);
    this.socket.emit("leave_channel", { channelId });
  }

  // Read status
  markAsRead(data: MarkAsReadPayload): void {
    if (!this.socket) return;
    this.socket.emit(WS_EVENTS.READ_STATUS.MARK_AS_READ, data);
  }

  // Typing indicators
  startTyping(data: TypingStartPayload): void {
    if (!this.socket) return;
    this.socket.emit(WS_EVENTS.TYPING.START, data);
  }

  stopTyping(data: TypingStartPayload): void {
    if (!this.socket) return;
    this.socket.emit(WS_EVENTS.TYPING.STOP, data);
  }

  // Reactions
  addReaction(data: AddReactionPayload): void {
    if (!this.socket) return;
    this.socket.emit(WS_EVENTS.REACTION.ADD, data);
  }

  removeReaction(data: AddReactionPayload): void {
    if (!this.socket) return;
    this.socket.emit(WS_EVENTS.REACTION.REMOVE, data);
  }

  // Event listeners
  on(event: string, callback: EventCallback): void {
    if (!this.socket?.connected) {
      this.pendingListeners.push({ event, callback });
      return;
    }
    this.socket.on(event, callback);
  }

  off(event: string, callback?: EventCallback): void {
    // Remove from pending listeners if not yet connected
    if (callback) {
      this.pendingListeners = this.pendingListeners.filter(
        (l) => !(l.event === event && l.callback === callback),
      );
    } else {
      this.pendingListeners = this.pendingListeners.filter(
        (l) => l.event !== event,
      );
    }
    if (!this.socket) return;
    this.socket.off(event, callback);
  }

  once(event: string, callback: EventCallback): void {
    if (!this.socket) return;
    this.socket.once(event, callback);
  }

  // Convenience methods for common events
  onNewMessage(callback: (event: NewMessageEvent) => void): void {
    this.on(WS_EVENTS.MESSAGE.NEW, callback);
  }

  onMessageUpdated(callback: (event: MessageUpdatedEvent) => void): void {
    this.on(WS_EVENTS.MESSAGE.UPDATED, callback);
  }

  onMessageDeleted(callback: (event: MessageDeletedEvent) => void): void {
    this.on(WS_EVENTS.MESSAGE.DELETED, callback);
  }

  onUserTyping(callback: (event: UserTypingEvent) => void): void {
    this.on(WS_EVENTS.TYPING.USER_TYPING, callback);
  }

  onReadStatusUpdated(callback: (event: ReadStatusUpdatedEvent) => void): void {
    this.on(WS_EVENTS.READ_STATUS.UPDATED, callback);
  }

  onChannelJoined(callback: (event: ChannelJoinedEvent) => void): void {
    this.on(WS_EVENTS.CHANNEL.JOINED, callback);
  }

  onChannelLeft(callback: (event: ChannelLeftEvent) => void): void {
    this.on(WS_EVENTS.CHANNEL.LEFT, callback);
  }

  onChannelCreated(callback: (event: ChannelCreatedEvent) => void): void {
    this.on(WS_EVENTS.CHANNEL.CREATED, callback);
  }

  onChannelUpdated(callback: (event: ChannelUpdatedEvent) => void): void {
    this.on(WS_EVENTS.CHANNEL.UPDATED, callback);
  }

  onChannelDeleted(callback: (event: ChannelDeletedEvent) => void): void {
    this.on(WS_EVENTS.CHANNEL.DELETED, callback);
  }

  onChannelArchived(callback: (event: ChannelArchivedEvent) => void): void {
    this.on(WS_EVENTS.CHANNEL.ARCHIVED, callback);
  }

  onChannelUnarchived(callback: (event: ChannelUnarchivedEvent) => void): void {
    this.on(WS_EVENTS.CHANNEL.UNARCHIVED, callback);
  }

  onUserOnline(callback: (event: UserOnlineEvent) => void): void {
    this.on(WS_EVENTS.USER.ONLINE, callback);
  }

  onUserOffline(callback: (event: UserOfflineEvent) => void): void {
    this.on(WS_EVENTS.USER.OFFLINE, callback);
  }

  onUserStatusChanged(callback: (event: UserStatusChangedEvent) => void): void {
    this.on(WS_EVENTS.USER.STATUS_CHANGED, callback);
  }

  onReactionAdded(callback: (event: ReactionAddedEvent) => void): void {
    this.on(WS_EVENTS.REACTION.ADDED, callback);
  }

  onReactionRemoved(callback: (event: ReactionRemovedEvent) => void): void {
    this.on(WS_EVENTS.REACTION.REMOVED, callback);
  }

  onWorkspaceMemberJoined(
    callback: (event: WorkspaceMemberJoinedEvent) => void,
  ): void {
    this.on(WS_EVENTS.WORKSPACE.MEMBER_JOINED, callback);
  }

  onWorkspaceMemberLeft(
    callback: (event: WorkspaceMemberLeftEvent) => void,
  ): void {
    this.on(WS_EVENTS.WORKSPACE.MEMBER_LEFT, callback);
  }

  onWorkspaceMemberRemoved(
    callback: (event: WorkspaceMemberRemovedEvent) => void,
  ): void {
    this.on(WS_EVENTS.WORKSPACE.MEMBER_REMOVED, callback);
  }

  // Notification events
  onNotificationNew(callback: (event: NotificationNewEvent) => void): void {
    this.on(WS_EVENTS.NOTIFICATION.NEW, (event) => {
      callback(event);
    });
  }

  onNotificationCountsUpdated(
    callback: (event: NotificationCountsUpdatedEvent) => void,
  ): void {
    this.on(WS_EVENTS.NOTIFICATION.COUNTS_UPDATED, (event) => {
      callback(event);
    });
  }

  onNotificationRead(callback: (event: NotificationReadEvent) => void): void {
    this.on(WS_EVENTS.NOTIFICATION.READ, callback);
  }

  offNotificationNew(callback: (event: NotificationNewEvent) => void): void {
    this.off(WS_EVENTS.NOTIFICATION.NEW, callback);
  }

  offNotificationCountsUpdated(
    callback: (event: NotificationCountsUpdatedEvent) => void,
  ): void {
    this.off(WS_EVENTS.NOTIFICATION.COUNTS_UPDATED, callback);
  }

  offNotificationRead(callback: (event: NotificationReadEvent) => void): void {
    this.off(WS_EVENTS.NOTIFICATION.READ, callback);
  }

  // Streaming events (AI bot)
  onStreamingStart(callback: (event: StreamingStartEvent) => void): void {
    this.on(WS_EVENTS.STREAMING.START, callback);
  }

  onStreamingContent(callback: (event: StreamingContentEvent) => void): void {
    this.on(WS_EVENTS.STREAMING.CONTENT, callback);
  }

  onStreamingThinkingContent(
    callback: (event: StreamingThinkingContentEvent) => void,
  ): void {
    this.on(WS_EVENTS.STREAMING.THINKING_CONTENT, callback);
  }

  onStreamingEnd(callback: (event: StreamingEndEvent) => void): void {
    this.on(WS_EVENTS.STREAMING.END, callback);
  }

  onStreamingAbort(callback: (event: StreamingAbortEvent) => void): void {
    this.on(WS_EVENTS.STREAMING.ABORT, callback);
  }
}

// Create singleton instance
const wsService = new WebSocketService();

export default wsService;
