/**
 * Contract test — `aHand` hub → team9 gateway webhook envelope.
 *
 * Phase 9 / Task 9.5. Pins the wire format that the hub emits and the
 * gateway accepts:
 *
 *   1. The canonical JSON Schema (`contracts/hub-webhook.json`, vendored
 *      from `aHand`) accepts the documented happy-path payloads for
 *      every `eventType` and rejects fuzz inputs we know to be wrong
 *      (unknown event types, missing required fields, malformed
 *      `deviceId`, malformed `eventId`).
 *   2. The gateway's `AhandHubWebhookController` accepts a
 *      schema-conforming + correctly-signed payload (HTTP 204) and
 *      rejects schema-violating payloads at the `ValidationPipe` (HTTP
 *      400) — proving the DTO and the schema agree on what's
 *      well-formed.
 *
 * Persistence + Redis side effects are out of scope. The
 * `AhandWebhookService` is stubbed at the DI boundary so this test runs
 * in a pure NestJS unit-style harness without a database. The
 * persistence-layer scenarios live in `ahand-persistence.e2e-spec.ts`
 * (Phase 9 / Task 9.2 second slice) and the wire-contract regressions
 * live in `ahand-integration.e2e-spec.ts` (Task 9.2 first slice).
 *
 * If this test fails, the most likely culprit is a hub-side schema
 * change that hasn't been mirrored into `contracts/hub-webhook.json`,
 * or a gateway DTO change that drifted from the schema. Either way,
 * the fix is to align the three: hub Rust serde struct ↔ schema ↔
 * gateway DTO.
 */

import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import express from 'express';
import request from 'supertest';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { AhandHubWebhookController } from '../../src/ahand/ahand-webhook.controller.js';
import { AhandWebhookService } from '../../src/ahand/ahand-webhook.service.js';

// ─── Schema loading ──────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
// Walk up from apps/server/apps/gateway/test/contracts/ to repo root.
const REPO_ROOT = resolve(HERE, '../../../../../../');
const WEBHOOK_SCHEMA_PATH = resolve(REPO_ROOT, 'contracts/hub-webhook.json');

const webhookSchema = JSON.parse(readFileSync(WEBHOOK_SCHEMA_PATH, 'utf8'));

// `Ajv` ships both CJS and an ESM dist. Under ts-jest's ESM transform,
// the default-import shape sometimes lands on `Ajv.default`. Guard so
// the test passes on either resolution.
const AjvCtor = (Ajv as unknown as { default?: typeof Ajv }).default ?? Ajv;
const addFormatsFn =
  (addFormats as unknown as { default?: typeof addFormats }).default ??
  addFormats;

const ajv = new AjvCtor({ strict: false, allErrors: true });
addFormatsFn(ajv);
const validateWebhook = ajv.compile(webhookSchema);

// ─── Canonical payload + helpers ─────────────────────────────────────────────

const VALID_DEVICE_ID = 'a'.repeat(64);
const SECRET = 'webhook-secret-key-32chars-long!!';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function canonicalPayload(): Record<string, unknown> {
  return {
    eventId: '01KPZXF939E45M8ZQN9GWFM0DY',
    eventType: 'device.heartbeat',
    deviceId: VALID_DEVICE_ID,
    externalUserId: '019cd29d-4852-748f-ad39-dbc28410914e',
    occurredAt: '2026-04-27T10:00:00.000Z',
    data: { sentAtMs: 1745740800000, presenceTtlSeconds: 180 },
  };
}

/**
 * Sign a payload the same way the hub does
 * (`crates/ahand-hub/src/webhook/sender.rs`): HMAC-SHA256 over
 * `{timestamp}.{rawBody}`. Returns the JSON body string + headers ready
 * for a supertest `.send`.
 */
function signPayload(payload: Record<string, unknown>): {
  body: string;
  headers: Record<string, string>;
} {
  const body = JSON.stringify(payload);
  const ts = String(nowSeconds());
  const sig = createHmac('sha256', SECRET)
    .update(`${ts}.${body}`)
    .digest('hex');
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-ahand-signature': `sha256=${sig}`,
      'x-ahand-timestamp': ts,
      'x-ahand-event-id': payload.eventId as string,
    },
  };
}

// ─── 1. Pure schema-validation tests ─────────────────────────────────────────

describe('hub-webhook contract — schema', () => {
  it('compiles cleanly', () => {
    expect(typeof validateWebhook).toBe('function');
  });

  it('accepts the canonical heartbeat payload', () => {
    const ok = validateWebhook(canonicalPayload());
    expect(validateWebhook.errors).toBeFalsy();
    expect(ok).toBe(true);
  });

  it.each([
    ['device.online', {}],
    ['device.offline', {}],
    ['device.registered', {}],
    ['device.revoked', {}],
  ])('accepts %s with empty data', (eventType, data) => {
    const payload = { ...canonicalPayload(), eventType, data };
    const ok = validateWebhook(payload);
    expect(validateWebhook.errors).toBeFalsy();
    expect(ok).toBe(true);
  });

  it('accepts heartbeat payloads with extra forward-compat fields in data', () => {
    const payload = {
      ...canonicalPayload(),
      data: {
        sentAtMs: 1745740800000,
        presenceTtlSeconds: 180,
        nickname: 'mac-mini',
        // Forward-compat: a future hub release may add cadence-related
        // fields. The heartbeat schema is `additionalProperties: true`
        // so the gateway tolerates them silently.
        cadenceMs: 30_000,
      },
    };
    expect(validateWebhook(payload)).toBe(true);
  });

  it('accepts both bare ULID and `evt_`-prefixed eventIds', () => {
    expect(
      validateWebhook({
        ...canonicalPayload(),
        eventId: '01KPZXF939E45M8ZQN9GWFM0DY',
      }),
    ).toBe(true);
    expect(
      validateWebhook({ ...canonicalPayload(), eventId: 'evt_LegacyHubV0' }),
    ).toBe(true);
  });

  it('treats externalUserId as optional', () => {
    const payload = canonicalPayload();
    delete payload.externalUserId;
    expect(validateWebhook(payload)).toBe(true);
  });

  describe('rejection cases', () => {
    it('rejects unknown eventType', () => {
      const bad = { ...canonicalPayload(), eventType: 'device.explode' };
      expect(validateWebhook(bad)).toBe(false);
    });

    it('rejects empty data on heartbeat events', () => {
      // Heartbeat MUST carry `sentAtMs` + `presenceTtlSeconds`.
      const bad = { ...canonicalPayload(), data: {} };
      expect(validateWebhook(bad)).toBe(false);
    });

    it('rejects non-empty data on lifecycle events', () => {
      // online/offline/registered/revoked carry an empty `{}` per the
      // hub source — the schema enforces `additionalProperties: false`
      // on their data so a mistakenly-attached extra field is caught
      // before reaching the gateway DTO.
      const bad = {
        ...canonicalPayload(),
        eventType: 'device.online',
        data: { unexpected: 'value' },
      };
      expect(validateWebhook(bad)).toBe(false);
    });

    it('rejects an empty-string externalUserId', () => {
      const bad = { ...canonicalPayload(), externalUserId: '' };
      expect(validateWebhook(bad)).toBe(false);
    });

    it.each(['eventId', 'eventType', 'deviceId', 'occurredAt', 'data'])(
      'rejects payloads missing required field %s',
      (field) => {
        const bad = canonicalPayload();
        delete bad[field];
        expect(validateWebhook(bad)).toBe(false);
      },
    );

    it('rejects deviceId that is not 64-char lowercase hex', () => {
      // Uppercase hex — the gateway DTO regex is also case-sensitive
      // lowercase, mirroring the hub-side serializer.
      const bad = { ...canonicalPayload(), deviceId: 'A'.repeat(64) };
      expect(validateWebhook(bad)).toBe(false);
      // Wrong length.
      expect(
        validateWebhook({ ...canonicalPayload(), deviceId: 'a'.repeat(63) }),
      ).toBe(false);
      // Non-hex character.
      expect(
        validateWebhook({
          ...canonicalPayload(),
          deviceId: 'g' + 'a'.repeat(63),
        }),
      ).toBe(false);
    });

    it('rejects occurredAt that is not RFC3339', () => {
      const bad = { ...canonicalPayload(), occurredAt: 'not-a-date' };
      expect(validateWebhook(bad)).toBe(false);
    });

    it('rejects extra top-level properties', () => {
      // Schema sets `additionalProperties: false` on the envelope to
      // detect typos / accidentally-added fields early.
      const bad = { ...canonicalPayload(), tenant: 'team9' };
      expect(validateWebhook(bad)).toBe(false);
    });
  });
});

// ─── 2. Gateway round-trip — controller accepts schema-conforming payload ────

describe('hub-webhook contract — gateway round-trip', () => {
  let app: INestApplication;
  let svc: {
    verifySignature: ReturnType<typeof jest.fn>;
    dedupe: ReturnType<typeof jest.fn>;
    clearDedupe: ReturnType<typeof jest.fn>;
    handleEvent: ReturnType<typeof jest.fn>;
  };

  beforeAll(() => {
    process.env.AHAND_HUB_WEBHOOK_SECRET = SECRET;
  });

  beforeEach(async () => {
    svc = {
      // Real signature check would need the raw body + clock skew check,
      // both of which we already cover in the unit-level service spec.
      // Here we only care that the controller passes them through, so
      // the stub accepts anything.
      verifySignature: jest.fn().mockReturnValue(undefined),
      dedupe: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
      clearDedupe: jest
        .fn<(eventId: string) => Promise<void>>()
        .mockResolvedValue(undefined),
      handleEvent: jest
        .fn<(evt: unknown) => Promise<void>>()
        .mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [AhandHubWebhookController],
      providers: [{ provide: AhandWebhookService, useValue: svc }],
    }).compile();

    app = module.createNestApplication();

    // Mirror main.ts: disable Nest's body parser, re-add express.json
    // with the raw-body verify hook so the controller can sign-check
    // off the original byte stream.
    app.use(
      express.json({
        verify: (req: unknown, _res, buf: Buffer) => {
          (req as { rawBody?: Buffer }).rawBody = buf;
        },
      }),
    );
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 204 for a schema-conforming + signed payload', async () => {
    const payload = canonicalPayload();
    expect(validateWebhook(payload)).toBe(true);
    const { body, headers } = signPayload(payload);
    await request(app.getHttpServer())
      .post('/api/v1/ahand/hub-webhook')
      .set(headers)
      .send(body)
      .expect(204);
    expect(svc.handleEvent).toHaveBeenCalledTimes(1);
    expect(svc.handleEvent.mock.calls[0]?.[0]).toMatchObject({
      eventId: payload.eventId,
      eventType: payload.eventType,
      deviceId: payload.deviceId,
    });
  });

  it('returns 204 silently for a duplicate (dedupe miss)', async () => {
    svc.dedupe.mockResolvedValue(false);
    const { body, headers } = signPayload(canonicalPayload());
    await request(app.getHttpServer())
      .post('/api/v1/ahand/hub-webhook')
      .set(headers)
      .send(body)
      .expect(204);
    expect(svc.handleEvent).not.toHaveBeenCalled();
  });

  it('rejects a payload the schema marks invalid (unknown eventType) at ValidationPipe', async () => {
    const payload = { ...canonicalPayload(), eventType: 'device.explode' };
    // Sanity-check the schema agrees this is invalid before asserting
    // against the gateway — proves the test isn't asserting on the
    // wrong oracle.
    expect(validateWebhook(payload)).toBe(false);
    const { body, headers } = signPayload(payload);
    await request(app.getHttpServer())
      .post('/api/v1/ahand/hub-webhook')
      .set(headers)
      .send(body)
      .expect(400);
    expect(svc.handleEvent).not.toHaveBeenCalled();
  });

  it('rejects a deviceId the schema marks invalid (uppercase hex) at ValidationPipe', async () => {
    const payload = { ...canonicalPayload(), deviceId: 'A'.repeat(64) };
    expect(validateWebhook(payload)).toBe(false);
    const { body, headers } = signPayload(payload);
    await request(app.getHttpServer())
      .post('/api/v1/ahand/hub-webhook')
      .set(headers)
      .send(body)
      .expect(400);
    expect(svc.handleEvent).not.toHaveBeenCalled();
  });

  it('accepts payloads with externalUserId omitted (regression guard for hub omitting it)', async () => {
    // The gateway DTO and the schema both treat externalUserId as
    // optional because the hub omits it on events where the owner is
    // unknown (`skip_serializing_if = "Option::is_none"`). This test
    // pins both sides — if either tightens to required, this fails.
    const payload = canonicalPayload();
    delete payload.externalUserId;
    expect(validateWebhook(payload)).toBe(true);
    const { body, headers } = signPayload(payload);
    await request(app.getHttpServer())
      .post('/api/v1/ahand/hub-webhook')
      .set(headers)
      .send(body)
      .expect(204);
  });
});
