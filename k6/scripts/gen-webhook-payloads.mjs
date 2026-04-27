#!/usr/bin/env node
/**
 * gen-webhook-payloads.mjs
 *
 * Pre-compute a batch of signed `device.heartbeat` / `device.online` /
 * `device.offline` webhook envelopes for the k6 load baseline. k6
 * itself runs in a Goja-based JS VM that doesn't expose Node's
 * `crypto` for raw HMAC-SHA256, so signing has to happen out-of-band.
 *
 * Output: a JSON array of `{body, signature, timestamp, eventId}` to
 * stdout — point `WEBHOOK_PAYLOADS_JSON` at the resulting file when
 * running `k6 run`.
 *
 * Why pre-sign:
 *
 *   1. The webhook controller (`AhandHubWebhookController`) verifies a
 *      Stripe-style signature over `{timestamp}.{rawBody}` with
 *      HMAC-SHA256. Computing that in-VM at 1k/s would dominate the
 *      benchmark.
 *
 *   2. The `x-ahand-timestamp` header has a ±5min skew window
 *      (`MAX_CLOCK_SKEW_MS` in `ahand-webhook.service.ts`). We
 *      timestamp every payload at "now" inside this script, so the
 *      generated batch has a ~5-minute usability window after the
 *      script exits. Re-run the generator immediately before each
 *      `k6 run`.
 *
 *   3. The `eventId` deduper (`AhandWebhookService.dedupe`) uses
 *      Redis SETNX with a 600s TTL. We emit fresh ULIDs for every
 *      payload so the test exercises the happy path; if you want to
 *      stress the dedupe path, run the same payload set twice
 *      back-to-back.
 *
 * Usage:
 *
 *   AHAND_HUB_WEBHOOK_SECRET=<secret> \
 *     COUNT=1000 \
 *     node k6/scripts/gen-webhook-payloads.mjs > /tmp/webhook-payloads.json
 */

import { createHmac, randomBytes } from 'node:crypto';

const SECRET = process.env.AHAND_HUB_WEBHOOK_SECRET;
if (!SECRET) {
  console.error(
    'AHAND_HUB_WEBHOOK_SECRET must be set. Pull it from your environment-specific secret store (e.g. AWS SSM `/team9/dev/AHAND_HUB_WEBHOOK_SECRET`).',
  );
  process.exit(2);
}

const COUNT = Number(process.env.COUNT ?? 1000);
const DEVICE_ID_POOL_SIZE = Number(process.env.DEVICE_ID_POOL_SIZE ?? 50);
const EXTERNAL_USER_ID =
  process.env.EXTERNAL_USER_ID ?? '019cd29d-4852-748f-ad39-dbc28410914e';

if (!Number.isFinite(COUNT) || COUNT <= 0) {
  console.error('COUNT must be a positive integer.');
  process.exit(2);
}
if (!Number.isFinite(DEVICE_ID_POOL_SIZE) || DEVICE_ID_POOL_SIZE <= 0) {
  console.error('DEVICE_ID_POOL_SIZE must be a positive integer.');
  process.exit(2);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** 32 random bytes hex-encoded → matches the on-wire deviceId shape. */
function newDeviceId() {
  return randomBytes(32).toString('hex');
}

/**
 * Generate a Crockford-base32 ULID (26 chars) — same shape the hub's
 * `ulid::Ulid::new()` emits. We use a fast, dependency-free
 * implementation since `crypto.randomUUID()` produces RFC4122 UUIDs,
 * which the gateway DTO also accepts but isn't what the hub sends.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newUlid() {
  // 48-bit timestamp + 80-bit randomness, encoded as 26 base32 chars.
  const tsMs = BigInt(Date.now());
  const rand = randomBytes(10);
  let ulid = '';
  // First 10 chars: timestamp (10 chars × 5 bits = 50 bits, top 2 bits zero).
  let t = tsMs;
  const tsChars = [];
  for (let i = 0; i < 10; i++) {
    tsChars.unshift(CROCKFORD[Number(t & 0x1fn)]);
    t >>= 5n;
  }
  ulid += tsChars.join('');
  // Last 16 chars: 80 bits of randomness.
  let bitBuf = 0n;
  let bitCount = 0;
  for (let i = 0; i < rand.length; i++) {
    bitBuf = (bitBuf << 8n) | BigInt(rand[i]);
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      ulid += CROCKFORD[Number((bitBuf >> BigInt(bitCount)) & 0x1fn)];
    }
  }
  return ulid;
}

/**
 * Sign `body` the same way the hub does
 * (`crates/ahand-hub/src/webhook/sender.rs`): HMAC-SHA256 over
 * `{timestamp}.{rawBody}`, hex-encoded, prefixed with `sha256=`.
 */
function signBody(rawBody, timestamp) {
  const sig = createHmac('sha256', SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return `sha256=${sig}`;
}

// ── Generation ─────────────────────────────────────────────────────────────

const devicePool = Array.from({ length: DEVICE_ID_POOL_SIZE }, newDeviceId);
const eventTypes = ['device.heartbeat', 'device.online', 'device.offline'];

const out = [];
for (let i = 0; i < COUNT; i++) {
  const eventType = eventTypes[i % eventTypes.length];
  const deviceId = devicePool[i % devicePool.length];
  const eventId = newUlid();
  const occurredAt = new Date().toISOString();

  const data =
    eventType === 'device.heartbeat'
      ? { sentAtMs: Date.now(), presenceTtlSeconds: 180 }
      : {};

  const payload = {
    eventId,
    eventType,
    deviceId,
    externalUserId: EXTERNAL_USER_ID,
    occurredAt,
    data,
  };

  // Field-order matters for HMAC stability — `JSON.stringify` over a
  // literal preserves declaration order on V8, so this is fine. If
  // we later switched to a builder that reorders, we'd need to pin
  // the field order explicitly.
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signBody(body, timestamp);

  out.push({ body, signature, timestamp, eventId });
}

process.stdout.write(JSON.stringify(out));
