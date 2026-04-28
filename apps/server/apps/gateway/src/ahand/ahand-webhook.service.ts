import { createHmac, timingSafeEqual } from 'crypto';
import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  and,
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { REDIS_CLIENT, type RedisType } from '@team9/redis';
import { env } from '@team9/shared';
import { AhandEventsGateway } from './ahand-events.gateway.js';
import { devicePresenceKey, webhookDedupeKey } from './ahand-redis-keys.js';
import { AhandRedisPublisher } from './ahand-redis-publisher.service.js';
import type { WebhookEventDto } from './dto/webhook-event.dto.js';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEDUPE_TTL_SECONDS = 600;

@Injectable()
export class AhandWebhookService {
  private readonly logger = new Logger(AhandWebhookService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private readonly redis: RedisType,
    private readonly publisher: AhandRedisPublisher,
    private readonly eventsGateway: AhandEventsGateway,
  ) {}

  private get secret(): Buffer {
    const s = env.AHAND_HUB_WEBHOOK_SECRET;
    if (!s) throw new Error('AHAND_HUB_WEBHOOK_SECRET not configured');
    return Buffer.from(s, 'utf8');
  }

  // ─── Signature verification ───────────────────────────────────────────────

  verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
  ): void {
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      throw new UnauthorizedException('Missing or malformed X-AHand-Signature');
    }
    if (!timestampHeader) {
      throw new UnauthorizedException('Missing X-AHand-Timestamp');
    }
    const ts = Number.parseInt(timestampHeader, 10);
    if (!Number.isFinite(ts)) {
      throw new UnauthorizedException('Invalid X-AHand-Timestamp');
    }
    if (Math.abs(Date.now() - ts * 1000) > MAX_CLOCK_SKEW_MS) {
      throw new UnauthorizedException(
        'X-AHand-Timestamp outside acceptable window',
      );
    }
    // Stripe-style signing input: `{timestamp}.{raw_body}` — matches Stream A's
    // hub webhook sender (crates/ahand-hub/src/webhook/sender.rs). This
    // prevents timestamp-header substitution replay attacks that could bypass
    // the clock-skew window if we signed rawBody alone.
    const signingInput = Buffer.concat([
      Buffer.from(`${timestampHeader}.`, 'utf8'),
      rawBody,
    ]);
    const expected = createHmac('sha256', this.secret)
      .update(signingInput)
      .digest('hex');
    const got = signatureHeader.slice('sha256='.length);
    // Length check before timingSafeEqual to avoid buffer-size mismatch error.
    if (got.length !== expected.length) {
      throw new UnauthorizedException('Signature mismatch');
    }
    if (!/^[0-9a-f]+$/i.test(got)) {
      throw new UnauthorizedException('Signature mismatch');
    }
    try {
      if (
        !timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'))
      ) {
        throw new UnauthorizedException('Signature mismatch');
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Signature mismatch');
    }
  }

  // ─── Idempotency ──────────────────────────────────────────────────────────

  async dedupe(eventId: string): Promise<boolean> {
    const res = await this.redis.set(
      webhookDedupeKey(eventId),
      '1',
      'EX',
      DEDUPE_TTL_SECONDS,
      'NX',
    );
    return res === 'OK';
  }

  async clearDedupe(eventId: string): Promise<void> {
    await this.redis.del(webhookDedupeKey(eventId)).catch(() => undefined);
  }

  // ─── Event dispatch ───────────────────────────────────────────────────────

  async handleEvent(evt: WebhookEventDto): Promise<void> {
    switch (evt.eventType) {
      case 'device.online': {
        // Cap TTL to 3600s to prevent malicious/erroneous values from creating
        // near-permanent Redis keys.
        const ttl = Math.min(Number(evt.data.presenceTtlSeconds ?? 180), 3600);
        await this.redis.set(
          devicePresenceKey(evt.deviceId),
          'online',
          'EX',
          ttl,
        );
        // Presence key is set here (before the DB ownership lookup) because the hub
        // has already confirmed the device is online. For devices without a DB row
        // (e.g. pre-registration race or stale hub state), the key expires naturally
        // after at most 3600s. Fan-out is gated on the ownership lookup below.
        // lastSeenAt updated after the ownership SELECT below (only when row exists).
        break;
      }
      case 'device.heartbeat': {
        // Cap TTL to 3600s to prevent malicious/erroneous values from creating
        // near-permanent Redis keys.
        const ttl = Math.min(Number(evt.data.presenceTtlSeconds ?? 180), 3600);
        await this.redis.set(
          devicePresenceKey(evt.deviceId),
          'online',
          'EX',
          ttl,
        );
        // Do NOT update last_seen_at on heartbeats — write amplification.
        break;
      }
      case 'device.offline': {
        await this.redis.del(devicePresenceKey(evt.deviceId));
        // lastSeenAt updated after the ownership SELECT below (only when row exists).
        break;
      }
      case 'device.revoked': {
        await this.redis.del(devicePresenceKey(evt.deviceId));
        // Only update (and fan-out) if the row transitions from active → revoked.
        // RETURNING gives us the row data for fan-out, avoiding a redundant SELECT.
        const updated = await this.db
          .update(schema.ahandDevices)
          .set({ status: 'revoked', revokedAt: new Date() })
          .where(
            and(
              eq(schema.ahandDevices.hubDeviceId, evt.deviceId),
              eq(schema.ahandDevices.status, 'active'),
            ),
          )
          .returning();
        if (updated.length === 0) {
          this.logger.debug(
            `device.revoked for ${evt.deviceId} — row already revoked or absent, skipping fan-out`,
          );
          return;
        }
        // Fan-out directly using the returned row — no need for a second SELECT.
        const revokedRow = updated[0];
        await this.publisher.publishForOwner({
          ownerType: revokedRow.ownerType as 'user' | 'workspace',
          ownerId: revokedRow.ownerId,
          eventType:
            'device.revoked' as import('./ahand-redis-publisher.service.js').AhandEventType,
          data: { ...evt.data, hubDeviceId: evt.deviceId },
        });
        this.eventsGateway.emitToOwner(
          revokedRow.ownerType as 'user' | 'workspace',
          revokedRow.ownerId,
          'device.revoked',
          {
            hubDeviceId: evt.deviceId,
            nickname: revokedRow.nickname,
            platform: revokedRow.platform,
            ...evt.data,
          },
        );
        return; // handled inline — skip the shared fan-out below
      }
      case 'device.registered':
        // DB row was created during the Tauri registration call; fan-out only.
        break;
    }

    // Heartbeat only refreshes the Redis presence key — no DB queries or fan-out.
    if (evt.eventType === 'device.heartbeat') return;

    // Resolve ownership for fan-out.
    const [row] = await this.db
      .select()
      .from(schema.ahandDevices)
      .where(and(eq(schema.ahandDevices.hubDeviceId, evt.deviceId)));
    if (!row) {
      this.logger.warn(
        `Webhook for unknown deviceId=${evt.deviceId}; skipping fan-out`,
      );
      return;
    }

    // Capability persistence: only on device.online / device.registered, only
    // when the hub provided the field (treat absent as "no information" — leave
    // existing column value alone). aHand hub-side serializes Vec<String> on
    // these two events (crates/ahand-hub/src/webhook/sender.rs).
    if (
      (evt.eventType === 'device.online' ||
        evt.eventType === 'device.registered') &&
      Array.isArray(evt.data.capabilities)
    ) {
      await this.db
        .update(schema.ahandDevices)
        .set({ capabilities: evt.data.capabilities })
        .where(
          and(
            eq(schema.ahandDevices.hubDeviceId, evt.deviceId),
            eq(schema.ahandDevices.status, 'active'),
          ),
        );
    }

    // Update last_seen_at for state-change events (not heartbeat, not registered)
    if (
      evt.eventType === 'device.online' ||
      evt.eventType === 'device.offline'
    ) {
      await this.updateLastSeen(evt.deviceId);
    }

    await this.publisher.publishForOwner({
      ownerType: row.ownerType as 'user' | 'workspace',
      ownerId: row.ownerId,
      eventType:
        evt.eventType as import('./ahand-redis-publisher.service.js').AhandEventType,
      data: { ...evt.data, hubDeviceId: evt.deviceId },
    });
    this.eventsGateway.emitToOwner(
      row.ownerType as 'user' | 'workspace',
      row.ownerId,
      evt.eventType,
      {
        hubDeviceId: evt.deviceId,
        nickname: row.nickname,
        platform: row.platform,
        ...evt.data,
      },
    );
  }

  private async updateLastSeen(hubDeviceId: string): Promise<void> {
    await this.db
      .update(schema.ahandDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.ahandDevices.hubDeviceId, hubDeviceId));
  }
}
