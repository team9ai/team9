import { describe, it, expect, beforeEach } from '@jest/globals';
import { AhandSessionTrackingService } from './ahand-session-tracking.service.js';

describe('AhandSessionTrackingService', () => {
  let svc: AhandSessionTrackingService;

  beforeEach(() => {
    svc = new AhandSessionTrackingService();
  });

  it('register + get round-trip', () => {
    svc.register({ sessionId: 's1', userId: 'u1', onlineDeviceIds: ['d1'] });
    const s = svc.get('s1');
    expect(s).toMatchObject({
      sessionId: 's1',
      userId: 'u1',
      onlineDeviceIds: ['d1'],
    });
  });

  it('get returns undefined for unknown sessionId', () => {
    expect(svc.get('unknown')).toBeUndefined();
  });

  it('unregister removes the entry', () => {
    svc.register({ sessionId: 's1', userId: 'u1', onlineDeviceIds: [] });
    svc.unregister('s1');
    expect(svc.get('s1')).toBeUndefined();
  });

  it('unregister is idempotent for unknown id', () => {
    expect(() => svc.unregister('no-such-session')).not.toThrow();
  });

  it('getByUser returns all sessions for that user', () => {
    svc.register({ sessionId: 's1', userId: 'u1', onlineDeviceIds: [] });
    svc.register({ sessionId: 's2', userId: 'u1', onlineDeviceIds: [] });
    svc.register({ sessionId: 's3', userId: 'u2', onlineDeviceIds: [] });
    const results = svc.getByUser('u1');
    expect(results.map((r) => r.sessionId).sort()).toEqual(['s1', 's2']);
  });

  it('getByUser returns empty array when no sessions for user', () => {
    expect(svc.getByUser('unknown-user')).toEqual([]);
  });

  it('updateOnlineDeviceIds replaces device list', () => {
    svc.register({ sessionId: 's1', userId: 'u1', onlineDeviceIds: ['d1'] });
    svc.updateOnlineDeviceIds('s1', ['d2', 'd3']);
    expect(svc.get('s1')!.onlineDeviceIds).toEqual(['d2', 'd3']);
  });

  it('updateOnlineDeviceIds is no-op for unknown sessionId', () => {
    expect(() => svc.updateOnlineDeviceIds('no-such', ['d1'])).not.toThrow();
  });
});
