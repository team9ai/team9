import { Injectable, Logger } from '@nestjs/common';
import { AhandSessionTrackingService } from './ahand-session-tracking.service.js';

export interface AhandDispatchInput {
  // 'user' and 'workspace' are the handled values; string allows any runtime
  // value from JSON without breaking the type contract.
  ownerType: string;
  ownerId: string;
  eventType: string;
  data: Record<string, unknown>;
}

/**
 * AhandSessionDispatcher maps device events from Redis pub/sub to session
 * tracking state.
 *
 * Architecture note: im-worker reaches claw-hive-worker only via
 * ClawHiveService (HTTP). There is no direct access to AgentSession in
 * this process. Hot component injection (addComponent / removeComponent)
 * requires a future REST endpoint on claw-hive-api; until that lands,
 * the dispatcher maintains the in-memory tracking registry so the next
 * session start picks up current device state via AhandBlueprintExtender.
 *
 * Event semantics:
 * - device.online   → add hubDeviceId to onlineDeviceIds in tracking
 * - device.offline  → remove hubDeviceId from onlineDeviceIds
 * - device.revoked  → remove hubDeviceId from onlineDeviceIds
 * - device.heartbeat → no-op (presence tick only)
 * - device.registered → no-op (no session impact until next start)
 * - workspace events → no-op for MVP
 *
 * Per-session errors are isolated; a failing session never blocks others.
 */
@Injectable()
export class AhandSessionDispatcher {
  private readonly logger = new Logger(AhandSessionDispatcher.name);

  constructor(private readonly tracking: AhandSessionTrackingService) {}

  dispatch(input: AhandDispatchInput): Promise<void> {
    if (input.ownerType !== 'user') {
      // Workspace routing deferred; skip for MVP.
      return Promise.resolve();
    }

    const sessions = this.tracking.getByUser(input.ownerId);
    if (sessions.length === 0) return Promise.resolve();

    const hubDeviceId =
      typeof input.data.hubDeviceId === 'string'
        ? input.data.hubDeviceId
        : null;

    // Synchronous loop: each session's dispatchToSession is called in sequence.
    // Per-session errors are caught individually, so one failing session never
    // blocks others. This isolation invariant holds because the loop is synchronous —
    // if dispatch were ever made async (e.g. awaiting addComponent), errors must
    // still be caught per-iteration to preserve the invariant.
    for (const s of sessions) {
      try {
        this.dispatchToSession(s.sessionId, input.eventType, hubDeviceId);
      } catch (e) {
        this.logger.warn(
          `Dispatch failed for session ${s.sessionId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return Promise.resolve();
  }

  private dispatchToSession(
    sessionId: string,
    eventType: string,
    hubDeviceId: string | null,
  ): void {
    switch (eventType) {
      case 'device.online': {
        if (!hubDeviceId) return;
        const state = this.tracking.get(sessionId);
        if (!state) return;
        if (state.onlineDeviceIds.includes(hubDeviceId)) return; // idempotent
        this.tracking.updateOnlineDeviceIds(sessionId, [
          ...state.onlineDeviceIds,
          hubDeviceId,
        ]);
        return;
      }
      case 'device.offline':
      case 'device.revoked': {
        if (!hubDeviceId) return;
        const state = this.tracking.get(sessionId);
        if (!state) return;
        if (!state.onlineDeviceIds.includes(hubDeviceId)) return; // already absent
        this.tracking.updateOnlineDeviceIds(
          sessionId,
          state.onlineDeviceIds.filter((id) => id !== hubDeviceId),
        );
        return;
      }
      case 'device.heartbeat':
      case 'device.registered':
      default:
        // No tracking update needed.
        return;
    }
  }
}
