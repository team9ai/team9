import { Injectable } from '@nestjs/common';

export interface AhandTrackingState {
  sessionId: string;
  userId: string;
  onlineDeviceIds: string[];
}

/**
 * In-memory registry mapping sessionId → AhandTrackingState.
 *
 * Populated by whatever code starts/ends agent sessions (post-broadcast
 * service or a future AgentSessionService).  AhandSessionDispatcher reads
 * from it to know which sessions belong to a given user.
 */
@Injectable()
export class AhandSessionTrackingService {
  private readonly registry = new Map<string, AhandTrackingState>();

  register(state: AhandTrackingState): void {
    this.registry.set(state.sessionId, state);
  }

  unregister(sessionId: string): void {
    this.registry.delete(sessionId);
  }

  get(sessionId: string): AhandTrackingState | undefined {
    return this.registry.get(sessionId);
  }

  getByUser(userId: string): AhandTrackingState[] {
    const out: AhandTrackingState[] = [];
    for (const s of this.registry.values()) {
      if (s.userId === userId) out.push(s);
    }
    return out;
  }

  updateOnlineDeviceIds(sessionId: string, ids: string[]): void {
    const s = this.registry.get(sessionId);
    if (s) this.registry.set(sessionId, { ...s, onlineDeviceIds: ids });
  }
}
