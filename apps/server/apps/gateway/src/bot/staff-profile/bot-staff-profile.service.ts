import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { BotExtra } from '@team9/database/schemas';
import {
  PERSONAL_STAFF_ROLE_TITLE,
  PERSONAL_STAFF_JOB_DESCRIPTION,
} from '../../applications/personal-staff.constants.js';

/**
 * Snapshot of a staff bot's identity, role, persona and mentor assignment —
 * the single JSON shape that the agent-side `Team9StaffProfileComponent`
 * consumes via `GET /api/v1/bot/staff/profile`.
 *
 * Mirrors `StaffProfileSnapshot` in `@team9claw/claw-hive-types`; redefined
 * locally because that package is not published to the team9 platform
 * monorepo. Keep the shape in sync.
 */
export interface StaffProfileSnapshot {
  agentId: string;
  botUserId: string;
  mentorUserId?: string;
  identity?: Record<string, unknown>;
  role?: {
    title?: string;
    description?: string;
  };
  persona?: {
    markdown?: string;
    version?: string;
  };
  updatedAt: string;
}

/**
 * PATCH payload accepted by `updateSnapshot`. Mirrors
 * `UpdateStaffProfileArgs` in `@team9claw/claw-hive-types` (without the
 * `ComponentConfig` base) — redefined locally for the same reason as
 * `StaffProfileSnapshot`. Keep in sync.
 */
export interface UpdateStaffProfileArgs {
  identityPatch?: Record<string, unknown>;
  role?: {
    title: string;
    description?: string;
  };
  persona?: {
    mode: 'append' | 'replace';
    content: string;
  };
}

type StaffKind = 'common' | 'personal';

interface BotRow {
  botUserId: string;
  mentorId: string | null;
  extra: BotExtra | null;
  managedMeta: { agentId?: string } | null;
  displayName: string | null;
  updatedAt: Date;
}

/**
 * Stateless adapter over the existing `im_bots` + `im_users` tables that
 * translates between the wire-facing `StaffProfileSnapshot` shape and the
 * scattered storage columns (`bots.extra.{commonStaff,personalStaff}`,
 * `bots.mentor_id`, `users.display_name`, `bots.managed_meta.agentId`).
 *
 * All write paths merge `bots.extra` and optionally `users.display_name`
 * inside a single transaction so snapshot reads never observe a partially
 * applied patch.
 */
@Injectable()
export class BotStaffProfileService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async getSnapshot(botUserId: string): Promise<StaffProfileSnapshot> {
    const row = await this.loadBotRow(botUserId);
    const kind = this.detectKind(row.extra);
    return this.rowToSnapshot(row, kind);
  }

  async updateSnapshot(
    botUserId: string,
    payload: UpdateStaffProfileArgs,
  ): Promise<StaffProfileSnapshot> {
    const row = await this.loadBotRow(botUserId);
    const kind = this.detectKind(row.extra);

    if (kind === 'personal' && payload.role !== undefined) {
      throw new BadRequestException('role is not editable for personal staff');
    }

    // `detectKind` guarantees `row.extra` is non-null and the relevant
    // kind block is present, so direct indexing is safe here without the
    // `?? {}` defensive fallbacks.
    const existingExtra: BotExtra = row.extra as BotExtra;
    const existingKindBlock =
      kind === 'common'
        ? (existingExtra.commonStaff as NonNullable<BotExtra['commonStaff']>)
        : (existingExtra.personalStaff as NonNullable<
            BotExtra['personalStaff']
          >);

    const mergedIdentity = this.mergeIdentityPatch(
      existingKindBlock.identity ?? {},
      payload.identityPatch,
    );

    const mergedPersona = this.applyPersona(
      existingKindBlock.persona,
      payload.persona,
    );

    const mergedKindBlock: Record<string, unknown> = {
      ...existingKindBlock,
      ...(payload.identityPatch !== undefined
        ? { identity: mergedIdentity }
        : {}),
      ...(kind === 'common' && payload.role?.title !== undefined
        ? { roleTitle: payload.role.title }
        : {}),
      ...(kind === 'common' && payload.role?.description !== undefined
        ? { jobDescription: payload.role.description }
        : {}),
      ...(mergedPersona !== undefined ? { persona: mergedPersona } : {}),
    };

    const updatedExtra: BotExtra = {
      ...existingExtra,
      [kind === 'common' ? 'commonStaff' : 'personalStaff']: mergedKindBlock,
    };

    const nextDisplayName = this.resolveNextDisplayName(payload.identityPatch);

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.bots)
        .set({ extra: updatedExtra, updatedAt: new Date() })
        .where(eq(schema.bots.userId, botUserId));
      if (nextDisplayName !== undefined) {
        await tx
          .update(schema.users)
          .set({ displayName: nextDisplayName })
          .where(eq(schema.users.id, botUserId));
      }
    });

    return this.getSnapshot(botUserId);
  }

  private async loadBotRow(botUserId: string): Promise<BotRow> {
    const rows = await this.db
      .select({
        botUserId: schema.bots.userId,
        mentorId: schema.bots.mentorId,
        extra: schema.bots.extra,
        managedMeta: schema.bots.managedMeta,
        displayName: schema.users.displayName,
        updatedAt: schema.bots.updatedAt,
      })
      .from(schema.bots)
      .innerJoin(schema.users, eq(schema.users.id, schema.bots.userId))
      .where(eq(schema.bots.userId, botUserId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Bot ${botUserId} not found`);
    }
    return row as BotRow;
  }

  private detectKind(extra: BotExtra | null): StaffKind {
    if (extra?.commonStaff) return 'common';
    if (extra?.personalStaff) return 'personal';
    throw new NotFoundException('Bot is not a staff bot');
  }

  private rowToSnapshot(row: BotRow, kind: StaffKind): StaffProfileSnapshot {
    // `detectKind` already confirmed `row.extra` and the relevant kind
    // block are both present, so these casts are safe.
    const extra = row.extra as BotExtra;
    const kindBlock =
      kind === 'common'
        ? (extra.commonStaff as NonNullable<BotExtra['commonStaff']>)
        : (extra.personalStaff as NonNullable<BotExtra['personalStaff']>);

    const role =
      kind === 'common'
        ? this.stripUndefined({
            title: (kindBlock as NonNullable<BotExtra['commonStaff']>)
              .roleTitle,
            description: (kindBlock as NonNullable<BotExtra['commonStaff']>)
              .jobDescription,
          })
        : {
            title: PERSONAL_STAFF_ROLE_TITLE,
            description: PERSONAL_STAFF_JOB_DESCRIPTION,
          };

    const snapshot: StaffProfileSnapshot = {
      agentId: row.managedMeta?.agentId ?? '',
      botUserId: row.botUserId,
      identity: kindBlock.identity ?? {},
      role,
      updatedAt: row.updatedAt.toISOString(),
    };

    if (row.mentorId) {
      snapshot.mentorUserId = row.mentorId;
    }
    if (kindBlock.persona !== undefined) {
      snapshot.persona = { markdown: kindBlock.persona };
    }
    return snapshot;
  }

  private mergeIdentityPatch(
    existing: Record<string, unknown>,
    patch: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (patch === undefined) return existing;
    const next: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    return next;
  }

  private applyPersona(
    existing: string | undefined,
    patch: UpdateStaffProfileArgs['persona'],
  ): string | undefined {
    if (patch === undefined) return undefined;
    if (patch.mode === 'replace') return patch.content;
    if (!existing) return patch.content;
    return `${existing}\n\n${patch.content}`;
  }

  /**
   * Compute the next value for `im_users.display_name` based on
   * `identityPatch.name`:
   * - `undefined` when the patch has no `name` key → leave users untouched.
   * - non-empty string → set display_name to that string.
   * - `null` or empty string → clear display_name to NULL.
   */
  private resolveNextDisplayName(
    patch: Record<string, unknown> | undefined,
  ): string | null | undefined {
    if (!patch || !('name' in patch)) return undefined;
    const value = patch.name;
    if (typeof value === 'string' && value.length > 0) return value;
    return null;
  }

  private stripUndefined<T extends Record<string, unknown>>(obj: T): T {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) out[key] = value;
    }
    return out as T;
  }
}
