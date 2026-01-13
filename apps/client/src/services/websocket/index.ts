import { io, Socket } from "socket.io-client";
import type {
  Message,
  WSMessage,
  WSMarkAsRead,
  WSTyping,
  WSReaction,
  WSUserTyping,
  WSChannelEvent,
} from "@/types/im";
import { queryClient } from "@/lib/query-client";

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

  // Message operations
  sendMessage(data: WSMessage): void {
    if (!this.socket) {
      console.warn("[WS] Cannot send message: not connected");
      return;
    }
    this.socket.emit("send_message", data);
  }

  markAsRead(data: WSMarkAsRead): void {
    if (!this.socket) return;
    this.socket.emit("mark_as_read", data);
  }

  // Typing indicators
  startTyping(data: WSTyping): void {
    if (!this.socket) return;
    this.socket.emit("typing_start", data);
  }

  stopTyping(data: WSTyping): void {
    if (!this.socket) return;
    this.socket.emit("typing_stop", data);
  }

  // Reactions
  addReaction(data: WSReaction): void {
    if (!this.socket) return;
    this.socket.emit("add_reaction", data);
  }

  removeReaction(data: WSReaction): void {
    if (!this.socket) return;
    this.socket.emit("remove_reaction", data);
  }

  // Event listeners
  on(event: string, callback: EventCallback): void {
    if (!this.socket?.connected) {
      console.log(`[WS] Queuing listener for event: ${event}`);
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
  onNewMessage(callback: (message: Message) => void): void {
    this.on("new_message", callback);
  }

  onMessageUpdated(callback: (message: Message) => void): void {
    this.on("message_updated", callback);
  }

  onMessageDeleted(callback: (data: { messageId: string }) => void): void {
    this.on("message_deleted", callback);
  }

  onUserTyping(callback: (data: WSUserTyping) => void): void {
    this.on("user_typing", callback);
  }

  onReadStatusUpdated(
    callback: (data: { channelId: string; userId: string }) => void,
  ): void {
    this.on("read_status_updated", callback);
  }

  onChannelJoined(callback: (data: WSChannelEvent) => void): void {
    this.on("channel_joined", callback);
  }

  onChannelLeft(callback: (data: WSChannelEvent) => void): void {
    this.on("channel_left", callback);
  }

  onChannelCreated(callback: (data: any) => void): void {
    this.on("channel_created", callback);
  }

  onUserOnline(
    callback: (data: { userId: string; status: string }) => void,
  ): void {
    this.on("user_online", callback);
  }

  onUserOffline(callback: (data: { userId: string }) => void): void {
    this.on("user_offline", callback);
  }

  onUserStatusChanged(
    callback: (data: { userId: string; status: string }) => void,
  ): void {
    this.on("user_status_changed", callback);
  }

  onReactionAdded(
    callback: (data: {
      messageId: string;
      userId: string;
      emoji: string;
    }) => void,
  ): void {
    this.on("reaction_added", callback);
  }

  onReactionRemoved(
    callback: (data: {
      messageId: string;
      userId: string;
      emoji: string;
    }) => void,
  ): void {
    this.on("reaction_removed", callback);
  }
}

// Create singleton instance
const wsService = new WebSocketService();

export default wsService;
