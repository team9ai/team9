import { io, Socket } from "socket.io-client";
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
} from "@/types/ws-events";

type EventCallback = (...args: any[]) => void;

class WebSocketService {
  private socket: Socket | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  // Queue for channels to join when connection is established
  private pendingChannelJoins: Set<string> = new Set();
  // Queue for event listeners to register when connection is established
  private pendingListeners: Array<{ event: string; callback: EventCallback }> =
    [];

  constructor() {
    // Auto-connect if token exists
    if (this.hasAuthToken()) {
      this.connect();
    }

    // Listen for browser online event to refresh data after network recovery
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.refreshQueriesAfterReconnect();
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
      return;
    }

    this.isConnecting = true;

    // Remove /api suffix from baseURL for WebSocket connection
    let baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
    baseURL = baseURL.replace(/\/api\/?$/, "");

    console.log("[WS] Connecting to:", `${baseURL}/im`);

    this.socket = io(`${baseURL}/im`, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      console.log("[WS] Connected successfully");
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      // Process pending channel joins
      this.processPendingJoins();
      // Process pending event listeners
      this.processPendingListeners();
    });

    this.socket.on("disconnect", (reason) => {
      console.log("[WS] Disconnected:", reason);
      this.isConnecting = false;
    });

    this.socket.on("connect_error", (error) => {
      console.error("[WS] Connection error:", error);
      this.isConnecting = false;
      this.reconnectAttempts++;
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
      this.disconnect();
    });

    this.socket.on("reconnect", () => {
      this.reconnectAttempts = 0;
      // Also refresh on reconnect in case authenticated event doesn't fire
      this.refreshQueriesAfterReconnect();
    });

    this.socket.on("reconnect_failed", () => {
      console.error("[WS] Reconnection failed after max attempts");
    });
  }

  disconnect(): void {
    if (this.socket) {
      console.log("[WS] Disconnecting...");
      this.socket.disconnect();
      this.socket = null;
      this.isConnecting = false;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  private refreshQueriesAfterReconnect(): void {
    // Force refetch active queries to get latest data including offline messages
    queryClient.refetchQueries({ queryKey: ["channels"], type: "active" });
    queryClient.refetchQueries({ queryKey: ["messages"], type: "active" });
    // Also refetch online users to get current status
    queryClient.refetchQueries({ queryKey: ["im-users", "online"] });
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
}

// Create singleton instance
const wsService = new WebSocketService();

export default wsService;
