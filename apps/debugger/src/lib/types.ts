export interface DebugEvent {
  id: string;
  timestamp: number;
  direction: "in" | "out";
  eventName: string;
  payload: unknown;
  channelId?: string;
  meta?: {
    streamId?: string;
    userId?: string;
    size: number;
  };
}

export interface ConnectionProfile {
  id: string;
  alias: string;
  serverUrl: string;
  token: string;
  lastUsed: number;
}

export interface StreamingSession {
  streamId: string;
  channelId: string;
  startedAt: number;
  chunks: string[];
  status: "active" | "ended" | "aborted";
}

/** Matches the server's StreamingStartEvent shape */
export interface StreamingStartPayload {
  streamId: string;
  channelId: string;
  parentId?: string;
}

export interface StreamingContentPayload {
  streamId: string;
  channelId: string;
  content: string;
}

export interface StreamingEndPayload {
  streamId: string;
  channelId: string;
}

export interface StreamingAbortPayload {
  streamId: string;
  channelId: string;
  reason: "error" | "cancelled" | "timeout" | "disconnect";
  error?: string;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: "direct" | "public" | "private";
  memberCount?: number;
}
