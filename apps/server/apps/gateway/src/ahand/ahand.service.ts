import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  and,
  DATABASE_CONNECTION,
  eq,
  inArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { REDIS_CLIENT, type RedisType } from '@team9/redis';
import { env } from '@team9/shared';
import { AhandHubClient } from './ahand-hub.client.js';
import { AhandRedisPublisher } from './ahand-redis-publisher.service.js';

export type OwnerType = 'user' | 'workspace';

type AhandDevice = typeof schema.ahandDevices.$inferSelect;

export interface RegisterDeviceInput {
  hubDeviceId: string;
  publicKey: string;
  nickname: string;
  platform: string;
  hostname?: string;
}

export interface RegisteredDeviceResult {
  device: AhandDevice;
  deviceJwt: string;
  hubUrl: string;
  jwtExpiresAt: string;
}

export interface DeviceWithPresence extends AhandDevice {
  // null when Redis could not be queried; caller decides how to render.
  isOnline: boolean | null;
}

// Device JWTs are 7d to match the Tauri session lifetime (spec § 4.6).
const DEVICE_JWT_TTL_SECONDS = 7 * 24 * 3600;

// Redis key shape used by hive-daemon heartbeat handler (Task 5.3 writes,
// this reads).
function presenceKey(hubDeviceId: string): string {
  return `ahand:device:${hubDeviceId}:presence`;
}

/**
 * AhandDevicesService owns the gateway-side device lifecycle: pre-register,
 * list, refresh JWT, rename, revoke, and the user.deleted cascade. It fans
 * work out to AhandHubClient (hub admin surface), Drizzle (persistence),
 * the ioredis client (presence reads), and AhandRedisPublisher (cross-
 * process notifications to im-worker).
 *
 * Controllers should only call methods on this service; keep all hub /
 * DB orchestration out of controller code.
 */
@Injectable()
export class AhandDevicesService {
  private readonly logger = new Logger(AhandDevicesService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly hub: AhandHubClient,
    private readonly publisher: AhandRedisPublisher,
    @Inject(REDIS_CLIENT) private readonly redis: RedisType,
  ) {}

  private requireHubUrl(): string {
    const url = env.AHAND_HUB_URL;
    if (!url) {
      throw new BadRequestException('ahand-hub is not configured');
    }
    return url;
  }

  // ─── registerDeviceForUser ────────────────────────────────────────────
  //
  // Multi-step flow: 1) hub pre-register, 2) DB insert, 3) mint JWT. Each
  // downstream step compensates upstream state on failure so callers never
  // observe a half-registered device.
  async registerDeviceForUser(
    userId: string,
    input: RegisterDeviceInput,
  ): Promise<RegisteredDeviceResult> {
    this.validateNickname(input.nickname);
    const hubUrl = this.requireHubUrl();

    // 0. Pre-flight: bail early if device already exists in DB so we don't
    //    pre-register with hub only to compensate the deletion of a live record.
    const existing = await this.db
      .select()
      .from(schema.ahandDevices)
      .where(eq(schema.ahandDevices.hubDeviceId, input.hubDeviceId));
    if (existing.length > 0) {
      throw new ConflictException('Device already registered');
    }

    // 1. Pre-register with hub.
    await this.hub.registerDevice({
      deviceId: input.hubDeviceId,
      publicKey: input.publicKey,
      externalUserId: userId,
    });

    // 2. Insert DB row. If insertion fails, roll back the hub record.
    let inserted: AhandDevice;
    try {
      const [row] = await this.db
        .insert(schema.ahandDevices)
        .values({
          ownerType: 'user',
          ownerId: userId,
          hubDeviceId: input.hubDeviceId,
          publicKey: input.publicKey,
          nickname: input.nickname,
          platform: input.platform,
          hostname: input.hostname ?? null,
          status: 'active',
        })
        .returning();
      inserted = row;
    } catch (e) {
      // Map postgres unique constraint violation to ConflictException
      if ((e as { code?: string }).code === '23505') {
        // Compensate hub registration since the device is already in DB
        await this.hub.deleteDevice(input.hubDeviceId).catch((err) => {
          this.logger.error(
            `Hub compensation DELETE failed for ${input.hubDeviceId}: ${describe(err)}`,
          );
        });
        throw new ConflictException('Device already registered');
      }
      this.logger.warn(
        `Rolling back hub registration for ${input.hubDeviceId} after DB insert failure: ${describe(e)}`,
      );
      await this.hub.deleteDevice(input.hubDeviceId).catch((err) => {
        this.logger.error(
          `Hub compensation DELETE failed for ${input.hubDeviceId}: ${describe(err)}`,
        );
      });
      throw e;
    }

    // 3. Mint initial device JWT; clean up DB row + hub on failure.
    let minted;
    try {
      minted = await this.hub.mintDeviceToken({
        deviceId: input.hubDeviceId,
        ttlSeconds: DEVICE_JWT_TTL_SECONDS,
      });
    } catch (e) {
      await this.db
        .delete(schema.ahandDevices)
        .where(eq(schema.ahandDevices.id, inserted.id))
        .catch(() => undefined);
      await this.hub.deleteDevice(input.hubDeviceId).catch(() => undefined);
      throw e;
    }

    await this.publisher.publishForOwner({
      ownerType: 'user',
      ownerId: userId,
      eventType: 'device.registered',
      data: { hubDeviceId: input.hubDeviceId, nickname: input.nickname },
    });

    return {
      device: inserted,
      deviceJwt: minted.token,
      hubUrl,
      jwtExpiresAt: minted.expiresAt,
    };
  }

  // ─── list ─────────────────────────────────────────────────────────────

  async listDevicesForOwner(
    ownerType: OwnerType,
    ownerId: string,
    opts: { includeOffline?: boolean; includeRevoked?: boolean } = {},
  ): Promise<DeviceWithPresence[]> {
    const filters = [
      eq(schema.ahandDevices.ownerType, ownerType),
      eq(schema.ahandDevices.ownerId, ownerId),
    ];
    if (!opts.includeRevoked) {
      filters.push(eq(schema.ahandDevices.status, 'active'));
    }
    const rows = await this.db
      .select()
      .from(schema.ahandDevices)
      .where(and(...filters));

    if (rows.length === 0) return [];

    let presence: (string | null)[] | null = null;
    try {
      presence = await this.redis.mget(
        ...rows.map((r) => presenceKey(r.hubDeviceId)),
      );
    } catch (e) {
      this.logger.warn(
        `Redis mget failed for device presence -- degrading to null: ${describe(e)}`,
      );
    }

    const enriched: DeviceWithPresence[] = rows.map((r, i) => ({
      ...r,
      isOnline: presence === null ? null : presence[i] === 'online',
    }));

    if (!opts.includeOffline) {
      return enriched.filter((d) => d.isOnline === true);
    }
    return enriched;
  }

  async listActiveDevicesForUser(
    userId: string,
    opts: { includeOffline?: boolean } = {},
  ): Promise<DeviceWithPresence[]> {
    return this.listDevicesForOwner('user', userId, {
      ...opts,
      includeRevoked: false,
    });
  }

  // ─── refresh / patch / revoke ────────────────────────────────────────

  async refreshDeviceToken(
    userId: string,
    deviceRowId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const device = await this.requireOwnedDevice(userId, deviceRowId);
    return this.hub.mintDeviceToken({
      deviceId: device.hubDeviceId,
      ttlSeconds: DEVICE_JWT_TTL_SECONDS,
    });
  }

  async mintControlPlaneTokenForUser(
    userId: string,
    deviceIds?: string[],
  ): Promise<{ token: string; expiresAt: string }> {
    if (deviceIds && deviceIds.length > 0) {
      const owned = await this.db
        .select()
        .from(schema.ahandDevices)
        .where(
          and(
            eq(schema.ahandDevices.ownerType, 'user'),
            eq(schema.ahandDevices.ownerId, userId),
            inArray(schema.ahandDevices.hubDeviceId, deviceIds),
          ),
        );
      const ownedIds = new Set(owned.map((r) => r.hubDeviceId));
      const foreign = deviceIds.filter((id) => !ownedIds.has(id));
      if (foreign.length > 0) {
        throw new ForbiddenException(
          `Device(s) not owned by user: ${foreign.join(', ')}`,
        );
      }
    }
    return this.hub.mintControlPlaneToken({
      externalUserId: userId,
      deviceIds,
      scope: 'jobs:execute',
    });
  }

  async patchDevice(
    userId: string,
    deviceRowId: string,
    patch: { nickname?: string },
  ): Promise<AhandDevice> {
    const existing = await this.requireOwnedDevice(userId, deviceRowId);
    if (patch.nickname !== undefined) {
      this.validateNickname(patch.nickname);
    }
    const [updated] = await this.db
      .update(schema.ahandDevices)
      .set({ nickname: patch.nickname ?? existing.nickname })
      .where(eq(schema.ahandDevices.id, existing.id))
      .returning();
    return updated;
  }

  async revokeDevice(userId: string, deviceRowId: string): Promise<void> {
    const device = await this.requireOwnedDevice(userId, deviceRowId);
    await this.db
      .update(schema.ahandDevices)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(schema.ahandDevices.id, device.id));
    try {
      await this.hub.deleteDevice(device.hubDeviceId);
    } catch (e) {
      // Row is already revoked; hub cleanup will reconcile via webhook.
      this.logger.warn(
        `Hub deleteDevice failed for ${device.hubDeviceId}: ${e instanceof Error ? e.message : String(e)}. ` +
          `DB row is already revoked; hub reconciliation will handle cleanup via device.revoked webhook.`,
      );
    }
    await this.publisher.publishForOwner({
      ownerType: device.ownerType as OwnerType,
      ownerId: device.ownerId,
      eventType: 'device.revoked',
      data: { hubDeviceId: device.hubDeviceId },
    });
  }

  // ─── user.deleted cascade ────────────────────────────────────────────

  @OnEvent('user.deleted')
  async onUserDeleted(payload: { userId: string }): Promise<void> {
    // Use RETURNING to atomically get-and-update, avoiding TOCTOU
    const updated = await this.db
      .update(schema.ahandDevices)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(
        and(
          eq(schema.ahandDevices.ownerType, 'user'),
          eq(schema.ahandDevices.ownerId, payload.userId),
          eq(schema.ahandDevices.status, 'active'),
        ),
      )
      .returning();
    if (updated.length === 0) return;
    for (const row of updated) {
      try {
        await this.hub.deleteDevice(row.hubDeviceId);
      } catch (e) {
        this.logger.warn(
          `Hub delete after user deletion failed for ${row.hubDeviceId}: ${describe(e)}`,
        );
      }
      this.publisher
        .publishForOwner({
          ownerType: row.ownerType as OwnerType,
          ownerId: row.ownerId,
          eventType: 'device.revoked',
          data: { hubDeviceId: row.hubDeviceId },
        })
        .catch((e) =>
          this.logger.warn(
            `Failed to publish device.revoked for user deletion: ${describe(e)}`,
          ),
        );
    }
  }

  // ─── internals ───────────────────────────────────────────────────────

  private async requireOwnedDevice(
    userId: string,
    deviceRowId: string,
  ): Promise<AhandDevice> {
    const [row] = await this.db
      .select()
      .from(schema.ahandDevices)
      .where(
        and(
          eq(schema.ahandDevices.id, deviceRowId),
          eq(schema.ahandDevices.ownerType, 'user'),
          eq(schema.ahandDevices.ownerId, userId),
        ),
      );
    // Return 404 (not 403) on owner mismatch to avoid leaking existence.
    if (!row) throw new NotFoundException('Device not found');
    if (row.status === 'revoked') {
      throw new ConflictException('Device has been revoked');
    }
    return row;
  }

  private validateNickname(nickname: string): void {
    if (
      typeof nickname !== 'string' ||
      nickname.length < 1 ||
      nickname.length > 120
    ) {
      throw new BadRequestException('Nickname must be 1-120 characters');
    }
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
