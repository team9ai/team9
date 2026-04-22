import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AhandSessionDispatcher } from './ahand-session-dispatcher.service.js';
import { AhandSessionTrackingService } from './ahand-session-tracking.service.js';

describe('AhandSessionDispatcher', () => {
  let dispatcher: AhandSessionDispatcher;
  let tracking: AhandSessionTrackingService;

  beforeEach(() => {
    tracking = new AhandSessionTrackingService();
    dispatcher = new AhandSessionDispatcher(tracking);
  });

  // ─── device.online ───────────────────────────────────────────────────────

  describe('device.online', () => {
    it('adds hubDeviceId to onlineDeviceIds', async () => {
      tracking.register({ sessionId: 's1', userId: 'u1', onlineDeviceIds: [] });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.online',
        data: { hubDeviceId: 'd1' },
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual(['d1']);
    });

    it('idempotent — duplicate online event is no-op', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.online',
        data: { hubDeviceId: 'd1' },
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual(['d1']); // no duplicate
    });

    it('no-op when hubDeviceId absent in data', async () => {
      tracking.register({ sessionId: 's1', userId: 'u1', onlineDeviceIds: [] });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.online',
        data: {},
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual([]);
    });
  });

  // ─── device.offline ──────────────────────────────────────────────────────

  describe('device.offline', () => {
    it('no-op when session is gone from registry (stale state)', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      // Snapshot session list, then remove the session from the registry
      // before dispatchToSession runs — simulates race condition.
      const origGetByUser = tracking.getByUser.bind(tracking);
      jest.spyOn(tracking, 'getByUser').mockImplementationOnce((uid) => {
        const r = origGetByUser(uid);
        tracking.unregister('s1');
        return r;
      });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.offline',
        data: { hubDeviceId: 'd1' },
      });
      // No throw, and the unregistered session is gone.
      expect(tracking.get('s1')).toBeUndefined();
    });

    it('no-op when hubDeviceId absent in data', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.offline',
        data: {},
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual(['d1']);
    });

    it('removes hubDeviceId from onlineDeviceIds', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1', 'd2'],
      });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.offline',
        data: { hubDeviceId: 'd1' },
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual(['d2']);
    });

    it('no-op when device not in tracking list', async () => {
      tracking.register({ sessionId: 's1', userId: 'u1', onlineDeviceIds: [] });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.offline',
        data: { hubDeviceId: 'ghost' },
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual([]);
    });
  });

  // ─── device.revoked ──────────────────────────────────────────────────────

  describe('device.revoked', () => {
    it('removes hubDeviceId same as offline', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.revoked',
        data: { hubDeviceId: 'd1' },
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual([]);
    });

    it('no-op when hubDeviceId absent in data', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.revoked',
        data: {},
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual(['d1']);
    });
  });

  // ─── no-op events ─────────────────────────────────────────────────────────

  describe('device.heartbeat', () => {
    it('no-op — does not touch tracking', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.heartbeat',
        data: { hubDeviceId: 'd1' },
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual(['d1']);
    });
  });

  describe('device.registered', () => {
    it('no-op', async () => {
      tracking.register({ sessionId: 's1', userId: 'u1', onlineDeviceIds: [] });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.registered',
        data: { hubDeviceId: 'd1' },
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual([]);
    });
  });

  describe('unknown eventType', () => {
    it('no-op (falls through default)', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'custom.event',
        data: {},
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual(['d1']);
    });
  });

  // ─── multi-session fan-out ─────────────────────────────────────────────────

  describe('multi-session fan-out', () => {
    it('applies event to all sessions for the user', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      tracking.register({
        sessionId: 's2',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      tracking.register({
        sessionId: 's3',
        userId: 'u2',
        onlineDeviceIds: ['d9'],
      });
      await dispatcher.dispatch({
        ownerType: 'user',
        ownerId: 'u1',
        eventType: 'device.offline',
        data: { hubDeviceId: 'd1' },
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual([]);
      expect(tracking.get('s2')!.onlineDeviceIds).toEqual([]);
      expect(tracking.get('s3')!.onlineDeviceIds).toEqual(['d9']); // untouched
    });

    it('per-session error with non-Error value is logged gracefully', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      jest
        .spyOn(tracking, 'updateOnlineDeviceIds')
        .mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'raw string error';
        });
      await expect(
        dispatcher.dispatch({
          ownerType: 'user',
          ownerId: 'u1',
          eventType: 'device.offline',
          data: { hubDeviceId: 'd1' },
        }),
      ).resolves.toBeUndefined();
    });

    it('per-session errors are isolated', async () => {
      tracking.register({
        sessionId: 's1',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });
      tracking.register({
        sessionId: 's2',
        userId: 'u1',
        onlineDeviceIds: ['d1'],
      });

      // Make updateOnlineDeviceIds throw on s1's call only
      const original = tracking.updateOnlineDeviceIds.bind(tracking);
      let calls = 0;
      jest
        .spyOn(tracking, 'updateOnlineDeviceIds')
        .mockImplementation((sessionId, ids) => {
          calls++;
          if (calls === 1) throw new Error('s1 exploded');
          original(sessionId, ids);
        });

      await expect(
        dispatcher.dispatch({
          ownerType: 'user',
          ownerId: 'u1',
          eventType: 'device.offline',
          data: { hubDeviceId: 'd1' },
        }),
      ).resolves.toBeUndefined();

      // s2 still processed
      expect(tracking.get('s2')!.onlineDeviceIds).toEqual([]);
      // s1's onlineDeviceIds should remain ['d1'] since the mutation threw
      expect(tracking.get('s1')?.onlineDeviceIds).toEqual(['d1']);
    });
  });

  // ─── workspace / no sessions ─────────────────────────────────────────────

  describe('workspace routing', () => {
    it('workspace ownerType is no-op (MVP)', async () => {
      tracking.register({ sessionId: 's1', userId: 'u1', onlineDeviceIds: [] });
      await dispatcher.dispatch({
        ownerType: 'workspace',
        ownerId: 'u1',
        eventType: 'device.online',
        data: { hubDeviceId: 'd1' },
      });
      expect(tracking.get('s1')!.onlineDeviceIds).toEqual([]);
    });
  });

  describe('no sessions for user', () => {
    it('early return when no sessions match', async () => {
      await expect(
        dispatcher.dispatch({
          ownerType: 'user',
          ownerId: 'nobody',
          eventType: 'device.online',
          data: { hubDeviceId: 'd1' },
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── session goes stale mid-iteration ──────────────────────────────────────

  describe('stale session (unregistered between getByUser and get)', () => {
    it('no-op when session is gone from registry', async () => {
      tracking.register({ sessionId: 's1', userId: 'u1', onlineDeviceIds: [] });
      // Simulate session being unregistered between getByUser snapshot and the
      // per-session dispatch call.
      const originalGetByUser = tracking.getByUser.bind(tracking);
      jest.spyOn(tracking, 'getByUser').mockImplementationOnce((userId) => {
        const result = originalGetByUser(userId);
        tracking.unregister('s1'); // gone mid-flight
        return result;
      });
      await expect(
        dispatcher.dispatch({
          ownerType: 'user',
          ownerId: 'u1',
          eventType: 'device.online',
          data: { hubDeviceId: 'd1' },
        }),
      ).resolves.toBeUndefined();
    });
  });
});
