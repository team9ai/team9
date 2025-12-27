import type { SSEEventType } from "@/types";

export interface SSEEventHandler {
  (type: SSEEventType, data: unknown): void;
}

/**
 * Create an SSE connection to an agent's event stream
 */
export function createAgentEventSource(
  agentId: string,
  onEvent: SSEEventHandler,
  onError?: (error: Event) => void,
): () => void {
  const eventSource = new EventSource(`/api/agents/${agentId}/events`);

  // Handle specific event types
  const eventTypes: SSEEventType[] = [
    "connected",
    "heartbeat",
    "state:change",
    "event:dispatch",
    "reducer:execute",
    "agent:paused",
    "agent:resumed",
    "subagent:spawn",
    "subagent:result",
    "compaction:start",
    "compaction:end",
    "error",
  ];

  eventTypes.forEach((type) => {
    eventSource.addEventListener(type, (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        onEvent(type, data);
      } catch {
        console.error(
          `Failed to parse SSE event data for ${type}:`,
          event.data,
        );
      }
    });
  });

  // Handle connection errors
  eventSource.onerror = (error) => {
    console.error("SSE connection error:", error);
    onError?.(error);
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}

/**
 * SSE connection manager for multiple agents
 */
export class AgentEventManager {
  private connections = new Map<string, () => void>();
  private handlers = new Map<string, Set<SSEEventHandler>>();

  /**
   * Subscribe to an agent's events
   */
  subscribe(agentId: string, handler: SSEEventHandler): () => void {
    // Add handler
    if (!this.handlers.has(agentId)) {
      this.handlers.set(agentId, new Set());
    }
    this.handlers.get(agentId)!.add(handler);

    // Create connection if not exists
    if (!this.connections.has(agentId)) {
      const cleanup = createAgentEventSource(
        agentId,
        (type, data) => {
          const handlers = this.handlers.get(agentId);
          handlers?.forEach((h) => h(type, data));
        },
        () => {
          // On error, try to reconnect after 5 seconds
          setTimeout(() => {
            if (
              this.handlers.has(agentId) &&
              this.handlers.get(agentId)!.size > 0
            ) {
              this.reconnect(agentId);
            }
          }, 5000);
        },
      );
      this.connections.set(agentId, cleanup);
    }

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(agentId);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.disconnect(agentId);
        }
      }
    };
  }

  /**
   * Disconnect from an agent's events
   */
  disconnect(agentId: string): void {
    const cleanup = this.connections.get(agentId);
    if (cleanup) {
      cleanup();
      this.connections.delete(agentId);
    }
    this.handlers.delete(agentId);
  }

  /**
   * Reconnect to an agent's events
   */
  private reconnect(agentId: string): void {
    const cleanup = this.connections.get(agentId);
    if (cleanup) {
      cleanup();
    }

    const newCleanup = createAgentEventSource(
      agentId,
      (type, data) => {
        const handlers = this.handlers.get(agentId);
        handlers?.forEach((h) => h(type, data));
      },
      () => {
        setTimeout(() => {
          if (
            this.handlers.has(agentId) &&
            this.handlers.get(agentId)!.size > 0
          ) {
            this.reconnect(agentId);
          }
        }, 5000);
      },
    );
    this.connections.set(agentId, newCleanup);
  }

  /**
   * Disconnect all connections
   */
  disconnectAll(): void {
    this.connections.forEach((cleanup) => cleanup());
    this.connections.clear();
    this.handlers.clear();
  }
}

// Global event manager instance
export const agentEventManager = new AgentEventManager();
