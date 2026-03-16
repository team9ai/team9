import { io, type Socket } from "socket.io-client";
import { useEventStore } from "@/stores/events";
import { useConnectionStore } from "@/stores/connection";
import { WS_EVENTS } from "@/lib/events";
import type { DebugEvent } from "@/lib/types";
import {
  generateId,
  extractChannelId,
  extractStreamId,
  extractUserId,
} from "@/lib/utils";
import { getChannels, getUser } from "./api";

let socket: Socket | null = null;
let pingIntervalId: ReturnType<typeof setInterval> | null = null;

function recordEvent(
  direction: "in" | "out",
  eventName: string,
  payload: unknown,
): DebugEvent {
  const event: DebugEvent = {
    id: generateId(),
    timestamp: Date.now(),
    direction,
    eventName,
    payload,
    channelId: extractChannelId(payload),
    meta: {
      streamId: extractStreamId(payload),
      userId: extractUserId(payload),
      size: JSON.stringify(payload ?? "").length,
    },
  };
  useEventStore.getState().addEvent(event);
  return event;
}

export function connect(serverUrl: string, token: string): void {
  if (socket?.connected) {
    socket.disconnect();
  }

  const connStore = useConnectionStore.getState();
  connStore.setStatus("connecting");

  // Connect to /im namespace
  const url = serverUrl.replace(/\/$/, "") + "/im";
  socket = io(url, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false, // manual reconnect only for debugging
  });

  socket.on("connect", () => {
    connStore.setStatus("authenticating");
    recordEvent("in", "connect", { socketId: socket?.id });
  });

  socket.on(WS_EVENTS.AUTH.AUTHENTICATED, (data: unknown) => {
    recordEvent("in", WS_EVENTS.AUTH.AUTHENTICATED, data);
    const payload = data as { userId?: string };
    connStore.setStatus("connected");
    if (payload.userId) {
      connStore.setBotIdentity(payload.userId, "bot");
      // Resolve username from user profile
      getUser(payload.userId)
        .then((user) => {
          const u = user as Record<string, unknown> | null;
          if (u?.username) {
            connStore.setBotIdentity(payload.userId!, u.username as string);
          }
        })
        .catch(() => {});
    }

    // Auto-load channels after authentication
    getChannels()
      .then((channelsData) => {
        if (Array.isArray(channelsData)) {
          connStore.setChannels(
            channelsData.map((ch: Record<string, unknown>) => ({
              id: ch.id as string,
              name: (ch.name as string) ?? "unnamed",
              type: (ch.type as "direct" | "public" | "private") ?? "public",
              memberCount: ch.memberCount as number | undefined,
            })),
          );
        }
      })
      .catch((e) => {
        console.warn("Failed to load channels:", e);
      });
  });

  socket.on(WS_EVENTS.AUTH.AUTH_ERROR, (data: unknown) => {
    recordEvent("in", WS_EVENTS.AUTH.AUTH_ERROR, data);
    const msg =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as Record<string, unknown>).message)
        : "Authentication failed";
    connStore.setStatus("error", msg);
  });

  socket.on("connect_error", (err: Error) => {
    recordEvent("in", "connect_error", { message: err.message });
    connStore.setStatus("error", err.message);
  });

  socket.on("disconnect", (reason: string) => {
    recordEvent("in", "disconnect", { reason });
    connStore.setStatus("disconnected");
  });

  // Intercept ALL incoming events
  socket.onAny((eventName: string, ...args: unknown[]) => {
    if (
      eventName === WS_EVENTS.AUTH.AUTHENTICATED ||
      eventName === WS_EVENTS.AUTH.AUTH_ERROR
    ) {
      return;
    }
    recordEvent("in", eventName, args.length === 1 ? args[0] : args);
  });

  // Latency measurement via ping with ack callback
  if (pingIntervalId) clearInterval(pingIntervalId);
  pingIntervalId = setInterval(() => {
    if (socket?.connected) {
      const start = Date.now();
      socket.emit(WS_EVENTS.SYSTEM.PING, { timestamp: start }, () => {
        useConnectionStore.getState().setLatency(Date.now() - start);
      });
    }
  }, 30000);
}

export function disconnect(): void {
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
    useConnectionStore.getState().reset();
  }
}

export function emit(
  eventName: string,
  payload: unknown,
  ack?: (...args: unknown[]) => void,
): void {
  if (!socket?.connected) {
    console.warn("Socket not connected");
    return;
  }
  recordEvent("out", eventName, payload);
  if (ack) {
    socket.emit(eventName, payload, ack);
  } else {
    socket.emit(eventName, payload);
  }
}

export function getSocket(): Socket | null {
  return socket;
}
