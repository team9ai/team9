/**
 * Wire-contract tests for WebhookEventDto — focused on the optional
 * `data.capabilities` field added for device.online / device.registered events.
 *
 * The hub emits capabilities when it knows them at emit time (e.g. the OS
 * feature set reported during registration). Old hub deployments omit the
 * field; we must accept both to remain forward-compatible.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WebhookEventDto } from './webhook-event.dto.js';

function makeEvent(
  eventType: 'device.online' | 'device.registered',
  data: Record<string, unknown>,
): WebhookEventDto {
  return plainToInstance(WebhookEventDto, {
    eventId: '01KPZXF939E45M8ZQN9GWFM0DY',
    eventType,
    occurredAt: '2026-04-28T00:00:00.000Z',
    deviceId: 'a'.repeat(64),
    data,
  });
}

describe('WebhookEventDto.data.capabilities', () => {
  it('accepts a valid string array on device.online', async () => {
    const dto = makeEvent('device.online', {
      capabilities: ['exec', 'browser'],
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts a valid string array on device.registered', async () => {
    const dto = makeEvent('device.registered', { capabilities: ['exec'] });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts an empty capabilities array', async () => {
    const dto = makeEvent('device.online', { capabilities: [] });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts payload omitting capabilities (forward-compat with old hub)', async () => {
    const dto = makeEvent('device.online', {});
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects non-array capabilities', async () => {
    const dto = makeEvent('device.online', { capabilities: 'browser' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-string entries', async () => {
    const dto = makeEvent('device.online', { capabilities: [123] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects oversized arrays (>32 entries)', async () => {
    const dto = makeEvent('device.online', {
      capabilities: Array(33).fill('x'),
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('WebhookEventDto.data.capabilities — heartbeat unaffected', () => {
  it('heartbeat without capabilities validates when sentAtMs and presenceTtlSeconds present', async () => {
    const dto = plainToInstance(WebhookEventDto, {
      eventId: '01KPZXF939E45M8ZQN9GWFM0DY',
      eventType: 'device.heartbeat',
      occurredAt: '2026-04-28T00:00:00.000Z',
      deviceId: 'a'.repeat(64),
      data: { sentAtMs: 1714262400000, presenceTtlSeconds: 60 },
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('heartbeat missing sentAtMs fails HeartbeatDataRequiredConstraint', async () => {
    const dto = plainToInstance(WebhookEventDto, {
      eventId: '01KPZXF939E45M8ZQN9GWFM0DY',
      eventType: 'device.heartbeat',
      occurredAt: '2026-04-28T00:00:00.000Z',
      deviceId: 'a'.repeat(64),
      data: { presenceTtlSeconds: 60 },
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
