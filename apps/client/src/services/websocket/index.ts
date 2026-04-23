import { io, Socket } from "socket.io-client";
import * as Sentry from "@sentry/react";
import { queryClient } from "@/lib/query-client";
import { API_BASE_URL } from "@/constants/api-base-url";
import {
  getAuthToken,
  getValidAccessToken,
  hasStoredAuthSession,
  redirectToLogin,
  refreshAccessToken,
} from "@/services/auth-session";
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
  type UserUpdatedEvent,
  type ReactionAddedEvent,
  type ReactionRemovedEvent,
  type WorkspaceMemberJoinedEvent,
  type WorkspaceMemberLeftEvent,
  type WorkspaceMemberRemovedEvent,
  type NotificationNewEvent,
  type NotificationCountsUpdatedEvent,
  type NotificationReadEvent,
  type NotificationAllReadEvent,
  type RoutineStatusChangedEvent,
  type RoutineExecutionCreatedEvent,
  type RoutineUpdatedEvent,
  type StreamingStartEvent,
  type StreamingContentEvent,
  type StreamingThinkingContentEvent,
  type StreamingEndEvent,
  type StreamingAbortEvent,
  type TrackingDeactivatedEvent,
  type TrackingActivatedEvent,
  type PropertyDefinitionCreatedEvent,
  type PropertyDefinitionUpdatedEvent,
  type PropertyDefinitionDeletedEvent,
  type MessagePropertyChangedEvent,
  type ViewCreatedEvent,
  type ViewUpdatedEvent,
  type ViewDeletedEvent,
  type TabCreatedEvent,
  type TabUpdatedEvent,
  type TabDeletedEvent,
  type MessageRelationChangedEvent,
  type MessageRelationsPurgedEvent,
} from "@/types/ws-events";

type EventCallback<TEvent = unknown> = (event: TEvent) => void;

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
type ConnectionChangeCallback = (status: ConnectionStatus) => void;
type TransportOrder = "websocket-first" | "polling-first";

class WebSocketService {
  private static readonly BASE_AUTH_RETRY_DELAY_MS = 1000;
  private static readonly MAX_AUTH_RETRY_DELAY_MS = 30000;
  private static readonly MAX_AUTH_RETRIES = 8;

  private socket: Socket | null = null;
  private isConnecting = false;
  private authErrorRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private authErrorRetryCount = 0;
  private authRecoveryInFlight: Promise<void> | null = null;
  // Queue for event listeners to register when connection is established
  private pendingListeners: Array<{ event: string; callback: EventCallback }> =
    [];
  // Connection status observers
  private connectionChangeCallbacks: Set<ConnectionChangeCallback> = new Set();
  private _connectionStatus: ConnectionStatus = "disconnected";
  private transportOrder: TransportOrder = "websocket-first";

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
    return hasStoredAuthSession();
  }

  private getAuthToken(): string | null {
    return getAuthToken();
  }

  connect(): void {
    void this.connectInternal();
  }

  private async connectInternal(): Promise<void> {
    if (this.socket?.connected || this.isConnecting) {
      console.log("[WS] Already connected or connecting");
      return;
    }

    this.isConnecting = true;

    const validAccessToken = await getValidAccessToken();
    if (!validAccessToken) {
      console.error("[WS] No valid auth token available");
      this.isConnecting = false;
      this.setConnectionStatus("disconnected");
      if (this.hasAuthToken()) {
        redirectToLogin();
      }
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

    this.setConnectionStatus("reconnecting");

    // Remove /api suffix from baseURL for WebSocket connection
    const baseURL = API_BASE_URL.replace(/\/api\/?$/, "");

    console.log("[WS] Connecting to:", `${baseURL}/im`);

    this.socket = io(`${baseURL}/im`, {
      // Always use latest token on each (re)connect attempt.
      auth: (cb) => {
        cb({ token: this.getAuthToken() });
      },
      // Prefer direct WebSocket, but allow a reconnect cycle to downgrade to
      // polling-first when some browsers or network paths reject the initial
      // upgrade request.
      transports: this.getTransports(),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 10000,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      console.log("[WS] Connected successfully");
      this.isConnecting = false;
      this.transportOrder = "websocket-first";
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

      if (this.transportOrder === "websocket-first") {
        console.warn(
          "[WS] Initial websocket handshake failed, retrying with polling-first transport order",
        );
        this.transportOrder = "polling-first";
        this.connect();
      }
    });

    this.socket.on("authenticated", () => {
      console.log("[WS] Authenticated successfully");
      this.refreshQueriesAfterReconnect();
    });

    // Channel list will be refreshed via query invalidation when a new channel is created
    this.socket.on("channel_created", () => {
      // No-op: server delivers messages via user rooms, no join needed
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
      void this.recoverFromAuthError();
    });

    this.socket.on("reconnect", () => {
      // Also refresh on reconnect in case authenticated event doesn't fire
      this.refreshQueriesAfterReconnect();
    });
  }

  private async recoverFromAuthError(): Promise<void> {
    if (this.authRecoveryInFlight) {
      return this.authRecoveryInFlight;
    }

    this.authRecoveryInFlight = (async () => {
      this.authErrorRetryCount++;
      if (this.authErrorRetryCount > WebSocketService.MAX_AUTH_RETRIES) {
        console.error("[WS] Max auth retries reached, giving up");
        this.authErrorRetryCount = 0;
        this.setConnectionStatus("disconnected");
        redirectToLogin();
        return;
      }

      const newToken = await refreshAccessToken();
      if (!newToken) {
        console.error("[WS] Failed to refresh token after auth error");
        this.authErrorRetryCount = 0;
        this.setConnectionStatus("disconnected");
        redirectToLogin();
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
    })().finally(() => {
      this.authRecoveryInFlight = null;
    });

    return this.authRecoveryInFlight;
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

  private getTransports(): Array<"websocket" | "polling"> {
    if (this.transportOrder === "polling-first") {
      return ["polling", "websocket"];
    }

    return ["websocket", "polling"];
  }

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

  private processPendingListeners(): void {
    if (!this.socket) return;
    for (const { event, callback } of this.pendingListeners) {
      console.log("[WS] Processing pending listener for event:", event);
      this.socket.on(event, callback);
    }
    this.pendingListeners = [];
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
  on<TEvent>(event: string, callback: EventCallback<TEvent>): void {
    const listener = callback as EventCallback;
    if (!this.socket?.connected) {
      this.pendingListeners.push({ event, callback: listener });
      return;
    }
    this.socket.on(event, listener);
  }

  off<TEvent>(event: string, callback?: EventCallback<TEvent>): void {
    const listener = callback as EventCallback | undefined;
    // Remove from pending listeners if not yet connected
    if (listener) {
      this.pendingListeners = this.pendingListeners.filter(
        (l) => !(l.event === event && l.callback === listener),
      );
    } else {
      this.pendingListeners = this.pendingListeners.filter(
        (l) => l.event !== event,
      );
    }
    if (!this.socket) return;
    this.socket.off(event, listener);
  }

  once<TEvent>(event: string, callback: EventCallback<TEvent>): void {
    if (!this.socket) return;
    this.socket.once(event, callback as EventCallback);
  }

  // Convenience methods for common events
  onNewMessage(callback: (event: NewMessageEvent) => void): void {
    this.on<NewMessageEvent>(WS_EVENTS.MESSAGE.NEW, callback);
  }

  onMessageUpdated(callback: (event: MessageUpdatedEvent) => void): void {
    this.on<MessageUpdatedEvent>(WS_EVENTS.MESSAGE.UPDATED, callback);
  }

  onMessageDeleted(callback: (event: MessageDeletedEvent) => void): void {
    this.on<MessageDeletedEvent>(WS_EVENTS.MESSAGE.DELETED, callback);
  }

  onUserTyping(callback: (event: UserTypingEvent) => void): void {
    this.on<UserTypingEvent>(WS_EVENTS.TYPING.USER_TYPING, callback);
  }

  onReadStatusUpdated(callback: (event: ReadStatusUpdatedEvent) => void): void {
    this.on<ReadStatusUpdatedEvent>(WS_EVENTS.READ_STATUS.UPDATED, callback);
  }

  onChannelJoined(callback: (event: ChannelJoinedEvent) => void): void {
    this.on<ChannelJoinedEvent>(WS_EVENTS.CHANNEL.JOINED, callback);
  }

  onChannelLeft(callback: (event: ChannelLeftEvent) => void): void {
    this.on<ChannelLeftEvent>(WS_EVENTS.CHANNEL.LEFT, callback);
  }

  onChannelCreated(callback: (event: ChannelCreatedEvent) => void): void {
    this.on<ChannelCreatedEvent>(WS_EVENTS.CHANNEL.CREATED, callback);
  }

  onChannelUpdated(callback: (event: ChannelUpdatedEvent) => void): void {
    this.on<ChannelUpdatedEvent>(WS_EVENTS.CHANNEL.UPDATED, callback);
  }

  onChannelDeleted(callback: (event: ChannelDeletedEvent) => void): void {
    this.on<ChannelDeletedEvent>(WS_EVENTS.CHANNEL.DELETED, callback);
  }

  onChannelArchived(callback: (event: ChannelArchivedEvent) => void): void {
    this.on<ChannelArchivedEvent>(WS_EVENTS.CHANNEL.ARCHIVED, callback);
  }

  onChannelUnarchived(callback: (event: ChannelUnarchivedEvent) => void): void {
    this.on<ChannelUnarchivedEvent>(WS_EVENTS.CHANNEL.UNARCHIVED, callback);
  }

  onUserOnline(callback: (event: UserOnlineEvent) => void): void {
    this.on<UserOnlineEvent>(WS_EVENTS.USER.ONLINE, callback);
  }

  onUserOffline(callback: (event: UserOfflineEvent) => void): void {
    this.on<UserOfflineEvent>(WS_EVENTS.USER.OFFLINE, callback);
  }

  onUserStatusChanged(callback: (event: UserStatusChangedEvent) => void): void {
    this.on<UserStatusChangedEvent>(WS_EVENTS.USER.STATUS_CHANGED, callback);
  }

  onUserUpdated(callback: (event: UserUpdatedEvent) => void): void {
    this.on<UserUpdatedEvent>(WS_EVENTS.USER.UPDATED, callback);
  }

  offUserUpdated(callback: (event: UserUpdatedEvent) => void): void {
    this.off<UserUpdatedEvent>(WS_EVENTS.USER.UPDATED, callback);
  }

  onReactionAdded(callback: (event: ReactionAddedEvent) => void): void {
    this.on<ReactionAddedEvent>(WS_EVENTS.REACTION.ADDED, callback);
  }

  onReactionRemoved(callback: (event: ReactionRemovedEvent) => void): void {
    this.on<ReactionRemovedEvent>(WS_EVENTS.REACTION.REMOVED, callback);
  }

  onWorkspaceMemberJoined(
    callback: (event: WorkspaceMemberJoinedEvent) => void,
  ): void {
    this.on<WorkspaceMemberJoinedEvent>(
      WS_EVENTS.WORKSPACE.MEMBER_JOINED,
      callback,
    );
  }

  onWorkspaceMemberLeft(
    callback: (event: WorkspaceMemberLeftEvent) => void,
  ): void {
    this.on<WorkspaceMemberLeftEvent>(
      WS_EVENTS.WORKSPACE.MEMBER_LEFT,
      callback,
    );
  }

  onWorkspaceMemberRemoved(
    callback: (event: WorkspaceMemberRemovedEvent) => void,
  ): void {
    this.on<WorkspaceMemberRemovedEvent>(
      WS_EVENTS.WORKSPACE.MEMBER_REMOVED,
      callback,
    );
  }

  // Notification events
  onNotificationNew(callback: (event: NotificationNewEvent) => void): void {
    this.on<NotificationNewEvent>(WS_EVENTS.NOTIFICATION.NEW, (event) => {
      callback(event);
    });
  }

  onNotificationCountsUpdated(
    callback: (event: NotificationCountsUpdatedEvent) => void,
  ): void {
    this.on<NotificationCountsUpdatedEvent>(
      WS_EVENTS.NOTIFICATION.COUNTS_UPDATED,
      (event) => {
        callback(event);
      },
    );
  }

  onNotificationRead(callback: (event: NotificationReadEvent) => void): void {
    this.on<NotificationReadEvent>(WS_EVENTS.NOTIFICATION.READ, callback);
  }

  onNotificationAllRead(
    callback: (event: NotificationAllReadEvent) => void,
  ): void {
    this.on(WS_EVENTS.NOTIFICATION.ALL_READ, callback);
  }

  offNotificationNew(callback: (event: NotificationNewEvent) => void): void {
    this.off<NotificationNewEvent>(WS_EVENTS.NOTIFICATION.NEW, callback);
  }

  offNotificationCountsUpdated(
    callback: (event: NotificationCountsUpdatedEvent) => void,
  ): void {
    this.off<NotificationCountsUpdatedEvent>(
      WS_EVENTS.NOTIFICATION.COUNTS_UPDATED,
      callback,
    );
  }

  offNotificationRead(callback: (event: NotificationReadEvent) => void): void {
    this.off<NotificationReadEvent>(WS_EVENTS.NOTIFICATION.READ, callback);
  }

  offNotificationAllRead(
    callback: (event: NotificationAllReadEvent) => void,
  ): void {
    this.off(WS_EVENTS.NOTIFICATION.ALL_READ, callback);
  }

  // Routine events
  onRoutineStatusChanged(
    callback: (event: RoutineStatusChangedEvent) => void,
  ): void {
    this.on<RoutineStatusChangedEvent>(
      WS_EVENTS.ROUTINE.STATUS_CHANGED,
      callback,
    );
  }

  onRoutineExecutionCreated(
    callback: (event: RoutineExecutionCreatedEvent) => void,
  ): void {
    this.on<RoutineExecutionCreatedEvent>(
      WS_EVENTS.ROUTINE.EXECUTION_CREATED,
      callback,
    );
  }

  offRoutineStatusChanged(
    callback: (event: RoutineStatusChangedEvent) => void,
  ): void {
    this.off<RoutineStatusChangedEvent>(
      WS_EVENTS.ROUTINE.STATUS_CHANGED,
      callback,
    );
  }

  offRoutineExecutionCreated(
    callback: (event: RoutineExecutionCreatedEvent) => void,
  ): void {
    this.off<RoutineExecutionCreatedEvent>(
      WS_EVENTS.ROUTINE.EXECUTION_CREATED,
      callback,
    );
  }

  onRoutineUpdated(callback: (event: RoutineUpdatedEvent) => void): void {
    this.on<RoutineUpdatedEvent>(WS_EVENTS.ROUTINE.UPDATED, callback);
  }

  offRoutineUpdated(callback: (event: RoutineUpdatedEvent) => void): void {
    this.off<RoutineUpdatedEvent>(WS_EVENTS.ROUTINE.UPDATED, callback);
  }

  // Streaming events (AI bot)
  onStreamingStart(callback: (event: StreamingStartEvent) => void): void {
    this.on<StreamingStartEvent>(WS_EVENTS.STREAMING.START, callback);
  }

  onStreamingContent(callback: (event: StreamingContentEvent) => void): void {
    this.on<StreamingContentEvent>(WS_EVENTS.STREAMING.CONTENT, callback);
  }

  onStreamingThinkingContent(
    callback: (event: StreamingThinkingContentEvent) => void,
  ): void {
    this.on<StreamingThinkingContentEvent>(
      WS_EVENTS.STREAMING.THINKING_CONTENT,
      callback,
    );
  }

  onStreamingEnd(callback: (event: StreamingEndEvent) => void): void {
    this.on<StreamingEndEvent>(WS_EVENTS.STREAMING.END, callback);
  }

  onStreamingAbort(callback: (event: StreamingAbortEvent) => void): void {
    this.on<StreamingAbortEvent>(WS_EVENTS.STREAMING.ABORT, callback);
  }

  // ── Channel Observe ──────────────────────────────

  observeChannel(channelId: string): void {
    if (!this.socket) return;
    this.socket.emit(WS_EVENTS.CHANNEL.OBSERVE, { channelId });
  }

  unobserveChannel(channelId: string): void {
    if (!this.socket) return;
    this.socket.emit(WS_EVENTS.CHANNEL.UNOBSERVE, { channelId });
  }

  // ── Tracking Events ──────────────────────────────

  onTrackingDeactivated(
    callback: (event: TrackingDeactivatedEvent) => void,
  ): void {
    this.on<TrackingDeactivatedEvent>(WS_EVENTS.TRACKING.DEACTIVATED, callback);
  }

  offTrackingDeactivated(
    callback: (event: TrackingDeactivatedEvent) => void,
  ): void {
    this.off<TrackingDeactivatedEvent>(
      WS_EVENTS.TRACKING.DEACTIVATED,
      callback,
    );
  }

  onTrackingActivated(callback: (event: TrackingActivatedEvent) => void): void {
    this.on<TrackingActivatedEvent>(WS_EVENTS.TRACKING.ACTIVATED, callback);
  }

  offTrackingActivated(
    callback: (event: TrackingActivatedEvent) => void,
  ): void {
    this.off<TrackingActivatedEvent>(WS_EVENTS.TRACKING.ACTIVATED, callback);
  }
  // ── Property System Events ──────────────────────────

  onPropertyDefinitionCreated(
    callback: (event: PropertyDefinitionCreatedEvent) => void,
  ): void {
    this.on<PropertyDefinitionCreatedEvent>(
      WS_EVENTS.PROPERTY.DEFINITION_CREATED,
      callback,
    );
  }

  offPropertyDefinitionCreated(
    callback: (event: PropertyDefinitionCreatedEvent) => void,
  ): void {
    this.off<PropertyDefinitionCreatedEvent>(
      WS_EVENTS.PROPERTY.DEFINITION_CREATED,
      callback,
    );
  }

  onPropertyDefinitionUpdated(
    callback: (event: PropertyDefinitionUpdatedEvent) => void,
  ): void {
    this.on<PropertyDefinitionUpdatedEvent>(
      WS_EVENTS.PROPERTY.DEFINITION_UPDATED,
      callback,
    );
  }

  offPropertyDefinitionUpdated(
    callback: (event: PropertyDefinitionUpdatedEvent) => void,
  ): void {
    this.off<PropertyDefinitionUpdatedEvent>(
      WS_EVENTS.PROPERTY.DEFINITION_UPDATED,
      callback,
    );
  }

  onPropertyDefinitionDeleted(
    callback: (event: PropertyDefinitionDeletedEvent) => void,
  ): void {
    this.on<PropertyDefinitionDeletedEvent>(
      WS_EVENTS.PROPERTY.DEFINITION_DELETED,
      callback,
    );
  }

  offPropertyDefinitionDeleted(
    callback: (event: PropertyDefinitionDeletedEvent) => void,
  ): void {
    this.off<PropertyDefinitionDeletedEvent>(
      WS_EVENTS.PROPERTY.DEFINITION_DELETED,
      callback,
    );
  }

  onMessagePropertyChanged(
    callback: (event: MessagePropertyChangedEvent) => void,
  ): void {
    this.on<MessagePropertyChangedEvent>(
      WS_EVENTS.PROPERTY.MESSAGE_CHANGED,
      callback,
    );
  }

  offMessagePropertyChanged(
    callback: (event: MessagePropertyChangedEvent) => void,
  ): void {
    this.off<MessagePropertyChangedEvent>(
      WS_EVENTS.PROPERTY.MESSAGE_CHANGED,
      callback,
    );
  }

  // ── View Events ──────────────────────────────────────

  onViewCreated(callback: (event: ViewCreatedEvent) => void): void {
    this.on<ViewCreatedEvent>(WS_EVENTS.VIEW.CREATED, callback);
  }

  offViewCreated(callback: (event: ViewCreatedEvent) => void): void {
    this.off<ViewCreatedEvent>(WS_EVENTS.VIEW.CREATED, callback);
  }

  onViewUpdated(callback: (event: ViewUpdatedEvent) => void): void {
    this.on<ViewUpdatedEvent>(WS_EVENTS.VIEW.UPDATED, callback);
  }

  offViewUpdated(callback: (event: ViewUpdatedEvent) => void): void {
    this.off<ViewUpdatedEvent>(WS_EVENTS.VIEW.UPDATED, callback);
  }

  onViewDeleted(callback: (event: ViewDeletedEvent) => void): void {
    this.on<ViewDeletedEvent>(WS_EVENTS.VIEW.DELETED, callback);
  }

  offViewDeleted(callback: (event: ViewDeletedEvent) => void): void {
    this.off<ViewDeletedEvent>(WS_EVENTS.VIEW.DELETED, callback);
  }

  // ── Tab Events ───────────────────────────────────────

  onTabCreated(callback: (event: TabCreatedEvent) => void): void {
    this.on<TabCreatedEvent>(WS_EVENTS.TAB.CREATED, callback);
  }

  offTabCreated(callback: (event: TabCreatedEvent) => void): void {
    this.off<TabCreatedEvent>(WS_EVENTS.TAB.CREATED, callback);
  }

  onTabUpdated(callback: (event: TabUpdatedEvent) => void): void {
    this.on<TabUpdatedEvent>(WS_EVENTS.TAB.UPDATED, callback);
  }

  offTabUpdated(callback: (event: TabUpdatedEvent) => void): void {
    this.off<TabUpdatedEvent>(WS_EVENTS.TAB.UPDATED, callback);
  }

  onTabDeleted(callback: (event: TabDeletedEvent) => void): void {
    this.on<TabDeletedEvent>(WS_EVENTS.TAB.DELETED, callback);
  }

  offTabDeleted(callback: (event: TabDeletedEvent) => void): void {
    this.off<TabDeletedEvent>(WS_EVENTS.TAB.DELETED, callback);
  }

  // ── Relation Events ──────────────────────────────────

  onRelationChanged(
    callback: (event: MessageRelationChangedEvent) => void,
  ): () => void {
    const listener = callback as EventCallback;
    if (!this.socket?.connected) {
      this.pendingListeners.push({
        event: WS_EVENTS.PROPERTY.RELATION_CHANGED,
        callback: listener,
      });
      return () =>
        this.off<MessageRelationChangedEvent>(
          WS_EVENTS.PROPERTY.RELATION_CHANGED,
          callback,
        );
    }
    this.socket.on(WS_EVENTS.PROPERTY.RELATION_CHANGED, listener);
    return () =>
      this.off<MessageRelationChangedEvent>(
        WS_EVENTS.PROPERTY.RELATION_CHANGED,
        callback,
      );
  }

  offRelationChanged(
    callback: (event: MessageRelationChangedEvent) => void,
  ): void {
    this.off<MessageRelationChangedEvent>(
      WS_EVENTS.PROPERTY.RELATION_CHANGED,
      callback,
    );
  }

  onRelationsPurged(
    callback: (event: MessageRelationsPurgedEvent) => void,
  ): () => void {
    const listener = callback as EventCallback;
    if (!this.socket?.connected) {
      this.pendingListeners.push({
        event: WS_EVENTS.PROPERTY.RELATIONS_PURGED,
        callback: listener,
      });
      return () =>
        this.off<MessageRelationsPurgedEvent>(
          WS_EVENTS.PROPERTY.RELATIONS_PURGED,
          callback,
        );
    }
    this.socket.on(WS_EVENTS.PROPERTY.RELATIONS_PURGED, listener);
    return () =>
      this.off<MessageRelationsPurgedEvent>(
        WS_EVENTS.PROPERTY.RELATIONS_PURGED,
        callback,
      );
  }

  offRelationsPurged(
    callback: (event: MessageRelationsPurgedEvent) => void,
  ): void {
    this.off<MessageRelationsPurgedEvent>(
      WS_EVENTS.PROPERTY.RELATIONS_PURGED,
      callback,
    );
  }
}

// Create singleton instance
const wsService = new WebSocketService();

export default wsService;
