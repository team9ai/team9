import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AhandEventsGateway } from './ahand-events.gateway.js';

describe('AhandEventsGateway (stub)', () => {
  let gw: AhandEventsGateway;

  function makeServer() {
    const emitSpy = { emit: (e: string, d: unknown) => ({ e, d }) };
    const toSpy = { to: (_room: string) => emitSpy };
    return { toSpy, emitSpy };
  }

  beforeEach(() => {
    gw = new AhandEventsGateway();
  });

  it('warns and does not throw when server not attached', () => {
    expect(() =>
      gw.emitToOwner('user', 'u1', 'device.online', { hubDeviceId: 'd1' }),
    ).not.toThrow();
  });

  it('emits to correct room after attachServer', () => {
    const emitFn = jest.fn();
    const srv = { to: (_room: string) => ({ emit: emitFn }) };
    gw.attachServer(srv);
    gw.emitToOwner('user', 'u1', 'device.online', { hubDeviceId: 'd1' });
    expect(emitFn).toHaveBeenCalledWith(
      'ahand:device.online',
      expect.objectContaining({ hubDeviceId: 'd1' }),
    );
  });
});
