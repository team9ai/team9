import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  alias,
  eq,
  and,
  sql,
  desc,
  isNull,
  inArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { ChannelSnapshot, BotExtra } from '@team9/database/schemas';
import {
  CreateChannelDto,
  UpdateChannelDto,
  UpdateMemberDto,
} from './dto/index.js';
import { CreateBotChannelDto } from './dto/create-bot-channel.dto.js';
import { RedisService } from '@team9/redis';
import { REDIS_KEYS } from '../shared/constants/redis-keys.js';
import { ChannelMemberCacheService } from '../shared/channel-member-cache.service.js';
import {
  resolveAgentType,
  type AgentType,
} from '../../common/utils/agent-type.util.js';
import { TabsService } from '../views/tabs.service.js';
import {
  resolveEffectiveMembership,
  type ChannelRole,
} from './effective-membership.js';

// Minimal interface needed from BotService to avoid a runtime circular import.
// The concrete implementation is injected via the 'BOT_SERVICE' token, which is
// provided by BotModule (global). Using a string token + interface avoids the
// channels.service.ts → bot.service.ts → channels.service.ts ESM cycle.
export const BOT_SERVICE_TOKEN = 'BOT_SERVICE' as const;
export interface IBotService {
  getBotMentorId(
    botUserId: string,
  ): Promise<{ mentorId: string | null; isActive: boolean } | null>;
  findActiveBotsByMentorId(
    mentorId: string,
    tenantId: string,
  ): Promise<{ botUserId: string }[]>;
}

// Aliased `users` row used to JOIN the bot owner alongside the channel-member
// user row (which is itself a join on `schema.users`). Declared at module
// scope so all three DM/member queries share the same alias name and so the
// generated SQL is deterministic. Uses `alias` (not `aliasedTable`) because
// drizzle's `aliasedTable<T>(): T` collapses select-row inference to `never`
// when the original table and its alias both appear in the same query.
const ownerUser = alias(schema.users, 'ownerUser');

export interface ChannelResponse {
  id: string;
  tenantId: string | null;
  name: string | null;
  description: string | null;
  type:
    | 'direct'
    | 'public'
    | 'private'
    | 'task'
    | 'tracking'
    | 'echo'
    | 'routine-session';
  avatarUrl: string | null;
  createdBy: string | null;
  sectionId: string | null;
  order: number;
  isArchived: boolean;
  isActivated: boolean;
  snapshot: ChannelSnapshot | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChannelWithUnread extends ChannelResponse {
  unreadCount: number;
  lastReadMessageId: string | null;
  showInDmSidebar?: boolean;
  otherUser?: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: 'online' | 'offline' | 'away' | 'busy';
    userType: 'human' | 'bot' | 'system';
    agentType: AgentType | null;
    staffKind: 'common' | 'personal' | 'other' | null;
    roleTitle: string | null;
    ownerName: string | null;
  };
}

export interface ChannelMemberResponse {
  id: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  isMuted: boolean;
  notificationsEnabled: boolean;
  joinedAt: Date;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: 'online' | 'offline' | 'away' | 'busy';
    userType: 'human' | 'bot' | 'system';
    agentType: AgentType | null;
    staffKind: 'common' | 'personal' | 'other' | null;
    roleTitle: string | null;
    ownerName: string | null;
    createdAt: Date;
  };
}

type ChannelUserSummaryRow = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: 'online' | 'offline' | 'away' | 'busy';
  userType: 'human' | 'bot' | 'system';
  applicationId: string | null;
  managedProvider: string | null;
  managedMeta: schema.ManagedMeta | null;
  botExtra: BotExtra | null;
  ownerDisplayName: string | null;
  ownerUsername: string | null;
};

/**
 * True iff `err` is a Postgres unique-constraint violation. postgres-js
 * exposes the SQLSTATE code on the thrown error object as `code`. 23505
 * is the canonical "unique_violation" class — see
 * https://www.postgresql.org/docs/current/errcodes-appendix.html.
 */
function isPgUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redis: RedisService,
    private readonly channelMemberCacheService: ChannelMemberCacheService,
    private readonly tabsService: TabsService,
    @Inject(BOT_SERVICE_TOKEN)
    private readonly botService: IBotService,
  ) {}

  /**
   * Check if a target user is a personal staff bot with restricted DM access.
   * Throws ForbiddenException if the requester is not the owner and DMs are not allowed.
   */
  async assertDirectMessageAllowed(
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    const [botRow] = await this.db
      .select({
        ownerId: schema.bots.ownerId,
        extra: schema.bots.extra,
        applicationId: schema.installedApplications.applicationId,
      })
      .from(schema.bots)
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(eq(schema.bots.userId, targetUserId))
      .limit(1);

    if (!botRow) return; // Not a bot — no restriction
    if (botRow.applicationId !== 'personal-staff') return; // Not a personal staff bot

    const extra = (botRow.extra as BotExtra) ?? {};
    const visibility = extra.personalStaff?.visibility;

    // Owner is always allowed
    if (botRow.ownerId === requesterId) return;

    if (!visibility?.allowDirectMessage) {
      throw new ForbiddenException(
        'This is a private assistant and is not open for direct messages.',
      );
    }
  }

  /**
   * Check if mentioning a set of user IDs is allowed for the given sender.
   * Throws BadRequestException if any mentioned user is a personal staff bot
   * with restricted mention access and the sender is not the owner.
   */
  async assertMentionsAllowed(
    senderId: string,
    mentionedUserIds: string[],
  ): Promise<void> {
    if (mentionedUserIds.length === 0) return;

    // Fetch bot rows for all mentioned user IDs in a single query
    const botRows = await this.db
      .select({
        userId: schema.bots.userId,
        ownerId: schema.bots.ownerId,
        extra: schema.bots.extra,
        applicationId: schema.installedApplications.applicationId,
      })
      .from(schema.bots)
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(inArray(schema.bots.userId, mentionedUserIds));

    for (const botRow of botRows) {
      if (botRow.applicationId !== 'personal-staff') continue;

      const extra = (botRow.extra as BotExtra) ?? {};
      const visibility = extra.personalStaff?.visibility;

      // Owner is always allowed
      if (botRow.ownerId === senderId) continue;

      if (!visibility?.allowMention) {
        throw new BadRequestException(
          'This is a private assistant and is not open for @mentions.',
        );
      }
    }
  }

  /**
   * Derives the user-summary view for DM/echo channel members.
   *
   * For bots, classifies into `staffKind`:
   * - `'common'` if `extra.commonStaff` is set (takes precedence over personal)
   * - `'personal'` if `extra.personalStaff` is set (resolves owner via aliased users join)
   * - `'other'` otherwise (no staff role)
   *
   * commonStaff/personalStaff are mutually exclusive per the data model
   * (see im_bots.ts BotExtra). If both are present we warn and pick common.
   */
  private mapChannelUserSummary(row: ChannelUserSummaryRow) {
    let staffKind: 'common' | 'personal' | 'other' | null = null;
    let roleTitle: string | null = null;
    let ownerName: string | null = null;

    if (row.userType === 'bot') {
      if (row.botExtra?.commonStaff) {
        staffKind = 'common';
        roleTitle = row.botExtra.commonStaff.roleTitle ?? null;
        // Mutually exclusive per data model — log the corruption case.
        if (row.botExtra.personalStaff) {
          this.logger.warn(
            `Bot ${row.userId} has both commonStaff and personalStaff in extra; preferring common`,
          );
        }
      } else if (row.botExtra?.personalStaff) {
        staffKind = 'personal';
        ownerName = row.ownerDisplayName ?? row.ownerUsername ?? null;
      } else {
        staffKind = 'other';
      }
    }

    return {
      id: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      status: row.status,
      userType: row.userType,
      agentType: resolveAgentType({
        userType: row.userType,
        applicationId: row.applicationId,
        managedProvider: row.managedProvider,
        managedMeta: row.managedMeta,
      }),
      staffKind,
      roleTitle,
      ownerName,
    };
  }

  async create(
    dto: CreateChannelDto,
    creatorId: string,
    tenantId?: string,
  ): Promise<ChannelResponse> {
    const [channel] = await this.db
      .insert(schema.channels)
      .values({
        id: uuidv7(),
        tenantId,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        avatarUrl: dto.avatarUrl,
        createdBy: creatorId,
      })
      .returning();

    // Add creator as owner
    await this.addMember(channel.id, creatorId, 'owner');

    // Seed built-in tabs for public/private channels. Properties are
    // created on demand via schema-on-write — no seed.
    if (dto.type === 'public' || dto.type === 'private') {
      await this.tabsService.seedBuiltinTabs(channel.id);
    }

    return channel;
  }

  async createDirectChannel(
    userId1: string,
    userId2: string,
    tenantId?: string,
  ): Promise<ChannelResponse> {
    // Self-chat: create or return existing echo channel
    if (userId1 === userId2) {
      return this.getOrCreateEchoChannel(userId1, tenantId);
    }

    // Permission check: verify the requester can DM the target
    // (blocks DMs to restricted personal staff bots)
    await this.assertDirectMessageAllowed(userId1, userId2);

    // Check if direct channel already exists
    const existingChannels = await this.db
      .select({ channelId: schema.channelMembers.channelId })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channels.id, schema.channelMembers.channelId),
      )
      .where(
        and(
          eq(schema.channels.type, 'direct'),
          sql`${schema.channelMembers.userId} IN (${userId1}, ${userId2})`,
          isNull(schema.channelMembers.leftAt),
          tenantId ? eq(schema.channels.tenantId, tenantId) : undefined,
        ),
      )
      .groupBy(schema.channelMembers.channelId)
      .having(sql`COUNT(DISTINCT ${schema.channelMembers.userId}) = 2`);

    if (existingChannels.length > 0) {
      const [existing] = await this.db
        .select()
        .from(schema.channels)
        .where(eq(schema.channels.id, existingChannels[0].channelId))
        .limit(1);
      return existing;
    }

    // Create new direct channel
    const [channel] = await this.db
      .insert(schema.channels)
      .values({
        id: uuidv7(),
        tenantId,
        type: 'direct',
        createdBy: userId1,
      })
      .returning();

    // Add both users
    await this.addMember(channel.id, userId1, 'member');
    await this.addMember(channel.id, userId2, 'member');

    return channel;
  }

  /**
   * Create a dedicated routine-session channel for a routine-bound agent
   * conversation (currently: creation; future: reflection / retrospective).
   *
   * Membership: creator + bot shadow user, both as 'member'.
   *
   * Atomicity: the channel row and both member rows are inserted inside a
   * single db.transaction so that a partial failure cannot leave an orphan
   * channel behind. We inline the member inserts (instead of calling
   * addMember()) because addMember() uses `this.db` directly and can't
   * accept a tx, and we need all three inserts on the same tx.
   *
   * No auto-unhide in im-worker — routine-session channels aren't routed
   * through DM visibility logic because their type isn't 'direct' / 'echo'.
   */
  async createRoutineSessionChannel(params: {
    creatorId: string;
    botUserId: string;
    tenantId: string;
    routineId: string;
    purpose: 'creation';
  }): Promise<ChannelResponse> {
    const { creatorId, botUserId, tenantId, routineId, purpose } = params;

    const propertySettings: unknown = {
      routineSession: { purpose, routineId },
    };

    const channel = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.channels)
        .values({
          id: uuidv7(),
          tenantId,
          type: 'routine-session',
          name: null,
          createdBy: creatorId,
          propertySettings,
        })
        .returning();

      await tx.insert(schema.channelMembers).values([
        {
          id: uuidv7(),
          channelId: row.id,
          userId: creatorId,
          role: 'member' as const,
        },
        {
          id: uuidv7(),
          channelId: row.id,
          userId: botUserId,
          role: 'member' as const,
        },
      ]);

      return row;
    });

    await this.channelMemberCacheService.invalidate(channel.id);
    await this.redis.invalidate(
      REDIS_KEYS.CHANNEL_MEMBER_ROLE(channel.id, creatorId),
    );
    await this.redis.invalidate(
      REDIS_KEYS.CHANNEL_MEMBER_ROLE(channel.id, botUserId),
    );

    return channel;
  }

  /**
   * Get or create an echo channel (self-chat) for the given user.
   * Echo channels have a single member (the owner).
   *
   * Invariants enforced here:
   *
   *   1. Atomicity of creation — when no existing channel is found, the
   *      channel row and the owner membership row are created inside the
   *      same db.transaction. A failure in either step rolls both back,
   *      so a partially-created (orphan) channel cannot leak into
   *      im_channels. Atomicity applies ONLY to the create-channel
   *      branch; the self-healing branch performs a single-row
   *      UPDATE/INSERT and does not need a transaction.
   *
   *   2. Self-healing lookup — the existence check queries im_channels
   *      directly by (type='echo', created_by, tenant_id) instead of
   *      innerJoin-ing against im_channel_members. If a legacy orphaned
   *      echo channel (channel row but no member row) is discovered, its
   *      membership is repaired in-place and the row is reused rather
   *      than creating a duplicate on every retry.
   *
   *   3. Post-commit cache invalidation — caches are invalidated AFTER
   *      the transaction has committed, so readers never observe
   *      in-flight state via the cache.
   *
   *   4. TOCTOU race recovery — migration 0040 adds a partial unique
   *      index `(created_by, tenant_id) WHERE type='echo' AND
   *      is_archived = false`, so two concurrent requests can no
   *      longer both INSERT a duplicate channel: the loser hits a
   *      Postgres unique violation (SQLSTATE 23505) and its
   *      transaction rolls back. We catch that specific error, re-read
   *      the winning row, repair its membership if needed, and return
   *      it — so the user still sees a single successful response. The
   *      index excludes archived rows so a user can re-create their
   *      echo channel after archiving the old one (should the
   *      application policy ever change to permit echo archive); the
   *      lookup helper below applies the same `is_archived = false`
   *      filter to keep that property end-to-end.
   */
  private async getOrCreateEchoChannel(
    userId: string,
    tenantId?: string,
  ): Promise<ChannelResponse> {
    // 1. Self-healing lookup — by channel.created_by, no join against
    //    channel_members, so orphaned rows are still discoverable.
    //    When tenantId is undefined (non-tenant context — e.g. Community
    //    edition without a JWT tenant claim) we match rows with a NULL
    //    tenant_id. Mixing tenanted and non-tenanted callers for the
    //    same user is not supported by this method.
    const existing = await this.findEchoChannelByOwner(userId, tenantId);

    if (existing) {
      await this.ensureEchoOwnerMembership(existing.id, userId);
      return existing;
    }

    // 2. No existing channel — create both rows atomically. If either
    //    INSERT fails, Drizzle rolls back the transaction and no orphan
    //    rows are left behind.
    let channel: ChannelResponse;
    try {
      channel = await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.channels)
          .values({
            id: uuidv7(),
            tenantId,
            type: 'echo',
            createdBy: userId,
          })
          .returning();

        await tx.insert(schema.channelMembers).values({
          id: uuidv7(),
          channelId: inserted.id,
          userId,
          role: 'owner',
        });

        return inserted;
      });
    } catch (err) {
      // 3. TOCTOU race — a concurrent request won the unique index race
      //    between our existence check and our INSERT. Re-read the
      //    winner's row and reuse it instead of bubbling the raw 23505.
      //    Logged at warn level (not error) so operators can confirm in
      //    Sentry/CloudWatch that the index is actually catching real
      //    races rather than them being purely theoretical.
      if (isPgUniqueViolation(err)) {
        this.logger.warn(
          `Echo channel TOCTOU race recovered for userId=${userId} tenantId=${tenantId ?? 'null'}`,
        );
        const winner = await this.findEchoChannelByOwner(userId, tenantId);
        if (winner) {
          await this.ensureEchoOwnerMembership(winner.id, userId);
          return winner;
        }
      }
      throw err;
    }

    // Post-commit cache invalidation — safe to run outside the transaction,
    // and must NOT run before commit (or readers could observe in-flight
    // state via the cache).
    await this.channelMemberCacheService.invalidate(channel.id);
    await this.redis.invalidate(
      REDIS_KEYS.CHANNEL_MEMBER_ROLE(channel.id, userId),
    );

    return channel;
  }

  /**
   * Look up the single active (non-archived) echo channel for
   * (userId, tenantId) without joining against im_channel_members, so
   * orphaned rows from before migration 0040's cleanup remain
   * discoverable. The `is_archived = false` filter mirrors the partial
   * unique index added in migration 0040 so this lookup can never
   * resurrect an archived channel and silently override the user's
   * intent to start fresh.
   */
  private async findEchoChannelByOwner(
    userId: string,
    tenantId: string | undefined,
  ): Promise<ChannelResponse | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.type, 'echo'),
          eq(schema.channels.createdBy, userId),
          eq(schema.channels.isArchived, false),
          tenantId
            ? eq(schema.channels.tenantId, tenantId)
            : isNull(schema.channels.tenantId),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * Ensure the given user is an active owner of the given echo channel.
   *
   * Handles three cases:
   *   - active member already present → no-op
   *   - previously left → UPDATE row to rejoin as owner
   *   - no row at all (orphaned channel) → INSERT a fresh owner row
   *
   * Uses an explicit column projection in the read query so that legacy
   * databases missing columns like `show_in_dm_sidebar` do not fail the
   * self-healing path.
   *
   * The INSERT branch uses onConflictDoNothing to stay safe under a
   * race: two concurrent self-heal callers can both observe "no member
   * row" and both INSERT, and the unique_channel_user constraint on
   * (channel_id, user_id) lets the second INSERT no-op rather than
   * throwing a 500 at the user.
   */
  private async ensureEchoOwnerMembership(
    channelId: string,
    userId: string,
  ): Promise<void> {
    const [existingMember] = await this.db
      .select({
        id: schema.channelMembers.id,
        leftAt: schema.channelMembers.leftAt,
      })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
        ),
      )
      .limit(1);

    if (existingMember && existingMember.leftAt === null) {
      return; // Already an active owner — nothing to do.
    }

    if (existingMember) {
      // Previously left — rejoin as owner.
      await this.db
        .update(schema.channelMembers)
        .set({
          leftAt: null,
          joinedAt: new Date(),
          role: 'owner',
        })
        .where(eq(schema.channelMembers.id, existingMember.id));
    } else {
      // Orphaned channel — insert the missing owner row.
      // onConflictDoNothing handles the race where a concurrent
      // self-heal already inserted the row between our SELECT and this
      // INSERT (see the doc comment above).
      await this.db
        .insert(schema.channelMembers)
        .values({
          id: uuidv7(),
          channelId,
          userId,
          role: 'owner',
        })
        .onConflictDoNothing();
    }

    await this.channelMemberCacheService.invalidate(channelId);
    await this.redis.invalidate(
      REDIS_KEYS.CHANNEL_MEMBER_ROLE(channelId, userId),
    );
  }

  /**
   * Batch-create DM channels between one user and multiple other users.
   * Skips pairs that already have an existing DM channel.
   * Uses 3 queries instead of N*3 for N members.
   *
   * Returns all DM channels (existing + newly created) mapped by the other user's ID.
   *
   * NOTE: This method does NOT run assertDirectMessageAllowed permission checks.
   * It is intended for trusted server-side flows (bot creation, workspace join).
   * Use createDirectChannel for user-initiated single-pair DM creation.
   */
  async createDirectChannelsBatch(
    newUserId: string,
    memberUserIds: string[],
    tenantId: string,
  ): Promise<Map<string, ChannelResponse>> {
    if (memberUserIds.length === 0) return new Map();

    // 1. Find all existing DM channels between newUserId and any of memberUserIds
    const existingDms = await this.db
      .select({
        channelId: schema.channelMembers.channelId,
        userId: schema.channelMembers.userId,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channels.id, schema.channelMembers.channelId),
      )
      .where(
        and(
          eq(schema.channels.type, 'direct'),
          eq(schema.channels.tenantId, tenantId),
          isNull(schema.channelMembers.leftAt),
          sql`${schema.channelMembers.channelId} IN (
            SELECT cm2.channel_id FROM im_channel_members cm2
            WHERE cm2.user_id = ${newUserId} AND cm2.left_at IS NULL
          )`,
          inArray(schema.channelMembers.userId, memberUserIds),
        ),
      );

    // Map: otherUserId -> channelId for existing DMs
    const existingMap = new Map<string, string>();
    for (const row of existingDms) {
      existingMap.set(row.userId, row.channelId);
    }

    // Determine which members need new DM channels
    const needNew = memberUserIds.filter((id) => !existingMap.has(id));

    // 2. Batch insert new channels
    const resultMap = new Map<string, ChannelResponse>();

    if (needNew.length > 0) {
      const channelRows = needNew.map((memberId) => ({
        id: uuidv7(),
        tenantId,
        type: 'direct' as const,
        createdBy: memberId,
      }));

      const insertedChannels = await this.db
        .insert(schema.channels)
        .values(channelRows)
        .returning();

      // 3. Batch insert channel members (2 per channel: newUser + existingMember)
      const memberRows = insertedChannels.flatMap((ch, i) => [
        {
          id: uuidv7(),
          channelId: ch.id,
          userId: needNew[i],
          role: 'member' as const,
        },
        {
          id: uuidv7(),
          channelId: ch.id,
          userId: newUserId,
          role: 'member' as const,
        },
      ]);

      await this.db.insert(schema.channelMembers).values(memberRows);

      for (let i = 0; i < insertedChannels.length; i++) {
        resultMap.set(needNew[i], insertedChannels[i]);
      }
    }

    // 4. Fetch existing channel details for already-existing DMs
    if (existingMap.size > 0) {
      const existingChannelIds = [...new Set(existingMap.values())];
      const channels = await this.db
        .select()
        .from(schema.channels)
        .where(inArray(schema.channels.id, existingChannelIds));

      const channelById = new Map(channels.map((c) => [c.id, c]));
      for (const [memberId, channelId] of existingMap) {
        const ch = channelById.get(channelId);
        if (ch) resultMap.set(memberId, ch);
      }
    }

    return resultMap;
  }

  async findById(id: string): Promise<ChannelResponse | null> {
    return this.redis.getOrSet(
      REDIS_KEYS.CHANNEL_CACHE(id),
      async () => {
        const [channel] = await this.db
          .select()
          .from(schema.channels)
          .where(eq(schema.channels.id, id))
          .limit(1);

        return channel || null;
      },
      120,
    );
  }

  async findByNameAndTenant(
    name: string,
    tenantId: string,
  ): Promise<ChannelResponse | null> {
    const [channel] = await this.db
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.name, name),
          eq(schema.channels.tenantId, tenantId),
        ),
      )
      .limit(1);

    return channel || null;
  }

  async sendSystemMessage(
    channelId: string,
    content: string,
  ): Promise<{
    id: string;
    channelId: string;
    senderId: null;
    content: string;
    type: 'system';
    isPinned: boolean;
    isEdited: boolean;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const [message] = await this.db
      .insert(schema.messages)
      .values({
        id: uuidv7(),
        channelId,
        content,
        type: 'system',
        senderId: null,
      })
      .returning();

    return {
      id: message.id,
      channelId: message.channelId,
      senderId: null,
      content: message.content ?? content,
      type: 'system',
      isPinned: message.isPinned,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  async findByIdOrThrow(
    id: string,
    userId?: string,
  ): Promise<ChannelWithUnread> {
    const channel = await this.findById(id);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // For direct/echo channels, fetch the other user's information
    if ((channel.type === 'direct' || channel.type === 'echo') && userId) {
      const otherUser =
        channel.type === 'echo'
          ? await this.getUserSummary(userId)
          : await this.getDmOtherUser(id, userId);

      return {
        ...channel,
        unreadCount: 0, // Not calculated for single channel view
        lastReadMessageId: null,
        otherUser: otherUser || undefined,
      };
    }

    return {
      ...channel,
      unreadCount: 0,
      lastReadMessageId: null,
    };
  }

  async update(
    id: string,
    dto: UpdateChannelDto,
    requesterId: string,
  ): Promise<ChannelResponse> {
    // Check permission using effective role (includes mentor-derived access)
    const tenantId = await this.getChannelTenantId(id);
    const role = tenantId
      ? await this.getEffectiveRole(id, requesterId, tenantId)
      : await this.getMemberRole(id, requesterId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const [channel] = await this.db
      .update(schema.channels)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, id))
      .returning();

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(id));

    return channel;
  }

  async getUserChannels(
    userId: string,
    tenantId?: string,
  ): Promise<ChannelWithUnread[]> {
    const direct = await this.getDirectUserChannels(userId, tenantId);

    // If tenantId is not provided we cannot safely scope the derivation query,
    // so skip the UNION and return only direct channels.
    if (!tenantId) {
      return direct;
    }

    // Fetch mentor-derived channel memberships (channels where the user
    // mentors an active bot that holds a membership).
    const derived = await resolveEffectiveMembership({
      db: this.db,
      botService: this.botService,
      userId,
      tenantId,
    });

    const directIds = new Set(direct.map((c) => c.id));
    const extraIds = derived
      .map((d) => d.channelId)
      .filter((id) => !directIds.has(id));

    if (extraIds.length === 0) {
      return direct;
    }

    // Load channel rows for derived-only ids with unread counts.
    const extras = await this.fetchChannelsByIds(extraIds, userId);
    return [...direct, ...extras];
  }

  /**
   * Direct-membership channel query — the original body of getUserChannels.
   * Returns channels where the user has an active `im_channel_members` row.
   */
  private async getDirectUserChannels(
    userId: string,
    tenantId?: string,
  ): Promise<ChannelWithUnread[]> {
    const result = await this.db
      .select({
        id: schema.channels.id,
        tenantId: schema.channels.tenantId,
        name: schema.channels.name,
        description: schema.channels.description,
        type: schema.channels.type,
        avatarUrl: schema.channels.avatarUrl,
        createdBy: schema.channels.createdBy,
        sectionId: schema.channels.sectionId,
        order: schema.channels.order,
        isArchived: schema.channels.isArchived,
        isActivated: schema.channels.isActivated,
        snapshot: schema.channels.snapshot,
        createdAt: schema.channels.createdAt,
        updatedAt: schema.channels.updatedAt,
        unreadCount:
          sql<number>`COALESCE(${schema.userChannelReadStatus.unreadCount}, 0)`.as(
            'unread_count',
          ),
        lastReadMessageId: schema.userChannelReadStatus.lastReadMessageId,
        showInDmSidebar: schema.channelMembers.showInDmSidebar,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channels.id, schema.channelMembers.channelId),
      )
      .leftJoin(
        schema.userChannelReadStatus,
        and(
          eq(
            schema.userChannelReadStatus.channelId,
            schema.channelMembers.channelId,
          ),
          eq(schema.userChannelReadStatus.userId, userId),
        ),
      )
      .where(
        and(
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
          tenantId ? eq(schema.channels.tenantId, tenantId) : undefined,
        ),
      );

    // For direct/echo channels, batch-fetch "other user" info in a single query
    const directChannelIds = result
      .filter((ch) => ch.type === 'direct')
      .map((ch) => ch.id);
    const echoChannelIds = result
      .filter((ch) => ch.type === 'echo')
      .map((ch) => ch.id);

    type UserSummary = {
      id: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      status: 'online' | 'offline' | 'away' | 'busy';
      userType: 'human' | 'bot' | 'system';
      agentType: AgentType | null;
      staffKind: 'common' | 'personal' | 'other' | null;
      roleTitle: string | null;
      ownerName: string | null;
    };
    const otherUserMap = new Map<string, UserSummary>();

    if (directChannelIds.length > 0) {
      const allMembers = await this.db
        .select({
          channelId: schema.channelMembers.channelId,
          userId: schema.channelMembers.userId,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          status: schema.users.status,
          userType: schema.users.userType,
          applicationId: schema.installedApplications.applicationId,
          managedProvider: schema.bots.managedProvider,
          managedMeta: schema.bots.managedMeta,
          botExtra: schema.bots.extra,
          ownerDisplayName: ownerUser.displayName,
          ownerUsername: ownerUser.username,
        })
        .from(schema.channelMembers)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.channelMembers.userId),
        )
        .leftJoin(
          schema.bots,
          eq(schema.bots.userId, schema.channelMembers.userId),
        )
        .leftJoin(ownerUser, eq(ownerUser.id, schema.bots.ownerId))
        .leftJoin(
          schema.installedApplications,
          eq(
            schema.bots.installedApplicationId,
            schema.installedApplications.id,
          ),
        )
        .where(
          and(
            inArray(schema.channelMembers.channelId, directChannelIds),
            isNull(schema.channelMembers.leftAt),
          ),
        );

      for (const member of allMembers) {
        if (member.userId !== userId) {
          otherUserMap.set(
            member.channelId,
            this.mapChannelUserSummary(member),
          );
        }
      }
    }

    // For echo channels, the "other user" is the current user (self)
    if (echoChannelIds.length > 0) {
      const selfSummary = await this.getUserSummary(userId);
      if (selfSummary) {
        for (const id of echoChannelIds) {
          otherUserMap.set(id, selfSummary);
        }
      }
    }

    return result.map((channel) => {
      if (channel.type === 'direct' || channel.type === 'echo') {
        return {
          ...channel,
          otherUser: otherUserMap.get(channel.id),
        };
      }
      // Strip showInDmSidebar from non-DM channels
      const { showInDmSidebar: _, ...rest } = channel;
      return rest;
    });
  }

  /**
   * Fetch channel rows (with unread counts) for a set of channel ids that are
   * derived via mentor-lookup and are NOT present in the user's direct-member
   * list. These channels are group/tracking channels — no otherUser enrichment.
   */
  private async fetchChannelsByIds(
    channelIds: string[],
    userId: string,
  ): Promise<ChannelWithUnread[]> {
    if (channelIds.length === 0) return [];

    const rows = await this.db
      .select({
        id: schema.channels.id,
        tenantId: schema.channels.tenantId,
        name: schema.channels.name,
        description: schema.channels.description,
        type: schema.channels.type,
        avatarUrl: schema.channels.avatarUrl,
        createdBy: schema.channels.createdBy,
        sectionId: schema.channels.sectionId,
        order: schema.channels.order,
        isArchived: schema.channels.isArchived,
        isActivated: schema.channels.isActivated,
        snapshot: schema.channels.snapshot,
        createdAt: schema.channels.createdAt,
        updatedAt: schema.channels.updatedAt,
        unreadCount:
          sql<number>`COALESCE(${schema.userChannelReadStatus.unreadCount}, 0)`.as(
            'unread_count',
          ),
        lastReadMessageId: schema.userChannelReadStatus.lastReadMessageId,
      })
      .from(schema.channels)
      .leftJoin(
        schema.userChannelReadStatus,
        and(
          eq(schema.userChannelReadStatus.channelId, schema.channels.id),
          eq(schema.userChannelReadStatus.userId, userId),
        ),
      )
      .where(inArray(schema.channels.id, channelIds));

    return rows.map((row) => ({
      ...row,
      // Derived-only channels are never DM/echo, so no otherUser needed.
    }));
  }

  /**
   * Get a user's summary info for echo channel display.
   */
  private async getUserSummary(userId: string): Promise<{
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: 'online' | 'offline' | 'away' | 'busy';
    userType: 'human' | 'bot' | 'system';
    agentType: AgentType | null;
    staffKind: 'common' | 'personal' | 'other' | null;
    roleTitle: string | null;
    ownerName: string | null;
  } | null> {
    const [user] = await this.db
      .select({
        userId: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        status: schema.users.status,
        userType: schema.users.userType,
        applicationId: sql<string | null>`NULL`,
        managedProvider: sql<string | null>`NULL`,
        managedMeta: sql<Record<string, unknown> | null>`NULL`,
        botExtra: sql<BotExtra | null>`NULL`,
        ownerDisplayName: sql<string | null>`NULL`,
        ownerUsername: sql<string | null>`NULL`,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) return null;
    return this.mapChannelUserSummary(user);
  }

  /**
   * Get the "other user" in a direct channel, with Redis cache.
   */
  private async getDmOtherUser(
    channelId: string,
    userId: string,
  ): Promise<{
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: 'online' | 'offline' | 'away' | 'busy';
    userType: 'human' | 'bot' | 'system';
    agentType: AgentType | null;
    staffKind: 'common' | 'personal' | 'other' | null;
    roleTitle: string | null;
    ownerName: string | null;
  } | null> {
    return this.redis.getOrSet(
      REDIS_KEYS.CHANNEL_DM_OTHER_USER(channelId, userId),
      async () => {
        const members = await this.db
          .select({
            userId: schema.channelMembers.userId,
            username: schema.users.username,
            displayName: schema.users.displayName,
            avatarUrl: schema.users.avatarUrl,
            status: schema.users.status,
            userType: schema.users.userType,
            applicationId: schema.installedApplications.applicationId,
            managedProvider: schema.bots.managedProvider,
            managedMeta: schema.bots.managedMeta,
            botExtra: schema.bots.extra,
            ownerDisplayName: ownerUser.displayName,
            ownerUsername: ownerUser.username,
          })
          .from(schema.channelMembers)
          .innerJoin(
            schema.users,
            eq(schema.users.id, schema.channelMembers.userId),
          )
          .leftJoin(
            schema.bots,
            eq(schema.bots.userId, schema.channelMembers.userId),
          )
          .leftJoin(ownerUser, eq(ownerUser.id, schema.bots.ownerId))
          .leftJoin(
            schema.installedApplications,
            eq(
              schema.bots.installedApplicationId,
              schema.installedApplications.id,
            ),
          )
          .where(
            and(
              eq(schema.channelMembers.channelId, channelId),
              isNull(schema.channelMembers.leftAt),
            ),
          );

        const otherUser = members.find((m) => m.userId !== userId);
        if (!otherUser) return null;

        return this.mapChannelUserSummary(otherUser);
      },
      120,
    );
  }

  async addMember(
    channelId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' = 'member',
    tx?: PostgresJsDatabase<typeof schema>,
  ): Promise<void> {
    const db = tx ?? this.db;
    // Check if user has any membership record (active or left)
    const [existing] = await db
      .select()
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
        ),
      )
      .limit(1);

    if (existing) {
      // User has a record
      if (existing.leftAt === null) {
        // Still an active member
        throw new ConflictException('User is already a member');
      }
      // User previously left - rejoin by clearing leftAt and updating joinedAt
      await db
        .update(schema.channelMembers)
        .set({
          leftAt: null,
          joinedAt: new Date(),
          role,
        })
        .where(eq(schema.channelMembers.id, existing.id));
    } else {
      // No existing record - insert new
      await db.insert(schema.channelMembers).values({
        id: uuidv7(),
        channelId,
        userId,
        role,
      });
    }

    await this.channelMemberCacheService.invalidate(channelId);
    await this.redis.invalidate(
      REDIS_KEYS.CHANNEL_MEMBER_ROLE(channelId, userId),
    );
  }

  async removeMember(
    channelId: string,
    userId: string,
    requesterId: string,
  ): Promise<void> {
    // Check requester permission using effective role (includes mentor-derived)
    const tenantId = await this.getChannelTenantId(channelId);
    const requesterRole = tenantId
      ? await this.getEffectiveRole(channelId, requesterId, tenantId)
      : await this.getMemberRole(channelId, requesterId);
    if (!requesterRole || !['owner', 'admin'].includes(requesterRole)) {
      // Allow users to remove themselves
      if (userId !== requesterId) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    await this.db
      .update(schema.channelMembers)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    await this.channelMemberCacheService.invalidate(channelId);
    await this.redis.invalidate(
      REDIS_KEYS.CHANNEL_MEMBER_ROLE(channelId, userId),
    );
  }

  async getMemberRole(
    channelId: string,
    userId: string,
  ): Promise<'owner' | 'admin' | 'member' | null> {
    return this.redis.getOrSet(
      REDIS_KEYS.CHANNEL_MEMBER_ROLE(channelId, userId),
      async () => {
        const [member] = await this.db
          .select({ role: schema.channelMembers.role })
          .from(schema.channelMembers)
          .where(
            and(
              eq(schema.channelMembers.channelId, channelId),
              eq(schema.channelMembers.userId, userId),
              isNull(schema.channelMembers.leftAt),
            ),
          )
          .limit(1);

        return member?.role || null;
      },
      120,
    );
  }

  async isMember(channelId: string, userId: string): Promise<boolean> {
    const role = await this.getMemberRole(channelId, userId);
    return role !== null;
  }

  /**
   * Derivation-aware membership check.
   *
   * Returns true when the user is a direct member OR when the user mentors an
   * active bot that is a member of the channel (spec §6.2 point 2).
   *
   * Use this for all auth-gate checks. Use isMember() only for non-auth
   * display purposes where the direct-only semantics are intentional (e.g.
   * deactivate/activate where the caller must literally be the bot itself).
   */
  async isChannelMember(
    channelId: string,
    userId: string,
    tenantId: string,
  ): Promise<boolean> {
    const role = await this.getEffectiveRole(channelId, userId, tenantId);
    return role !== null;
  }

  /**
   * Retrieve the tenantId for a channel. Returns null if the channel
   * doesn't exist or has no tenant. Used by auth guards and
   * getEffectiveRole when the request doesn't carry a tenant header.
   */
  async getChannelTenantId(channelId: string): Promise<string | null> {
    const channel = await this.findById(channelId);
    return channel?.tenantId ?? null;
  }

  /**
   * Resolve a user's effective role on a channel, combining direct membership
   * with mentor derivation.
   *
   * - Tenant scope is required for derivation. If `tenantId` is omitted/null,
   *   this method fetches the channel's tenantId via `getChannelTenantId`.
   * - For tenantless channels (DMs with no tenantId), falls back to the cached
   *   direct lookup via `getMemberRole`, since mentor derivation is per-tenant.
   */
  async getEffectiveRole(
    channelId: string,
    userId: string,
    tenantId?: string | null,
  ): Promise<ChannelRole | null> {
    const resolvedTenantId =
      tenantId ?? (await this.getChannelTenantId(channelId));
    if (resolvedTenantId) {
      return resolveEffectiveMembership({
        db: this.db,
        botService: this.botService,
        userId,
        tenantId: resolvedTenantId,
        channelId,
      });
    }
    // Channel has no tenant (e.g. DM) — fall back to direct membership
    return this.getMemberRole(channelId, userId);
  }

  /**
   * Assert that a user has read access to a channel.
   * - Channel members (direct or mentor-derived) always have access (§6.2 #2).
   * - Public channels are readable by anyone.
   * - Tracking channels are readable by any tenant member.
   * Throws ForbiddenException if none of the above apply.
   */
  async assertReadAccess(channelId: string, userId: string): Promise<void> {
    const channel = await this.findById(channelId);
    if (!channel) throw new ForbiddenException('Access denied');

    // Use derivation-aware membership when tenantId is available (§6.2 #2).
    // Fall back to direct-only check for channels without a tenant.
    const member = channel.tenantId
      ? await this.isChannelMember(channelId, userId, channel.tenantId)
      : await this.isMember(channelId, userId);
    if (member) return;

    if (channel.type === 'public') return;
    if (
      channel.type === 'tracking' &&
      channel.tenantId &&
      (await this.isUserInTenant(userId, channel.tenantId))
    ) {
      return;
    }

    throw new ForbiddenException('Access denied');
  }

  async isBot(userId: string): Promise<boolean> {
    const [user] = await this.db
      .select({ userType: schema.users.userType })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return user?.userType === 'bot';
  }

  async getChannelMembers(channelId: string): Promise<ChannelMemberResponse[]> {
    const result = await this.db
      .select({
        id: schema.channelMembers.id,
        userId: schema.channelMembers.userId,
        role: schema.channelMembers.role,
        isMuted: schema.channelMembers.isMuted,
        notificationsEnabled: schema.channelMembers.notificationsEnabled,
        joinedAt: schema.channelMembers.joinedAt,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        status: schema.users.status,
        userType: schema.users.userType,
        createdAt: schema.users.createdAt,
        applicationId: schema.installedApplications.applicationId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
        botExtra: schema.bots.extra,
        ownerDisplayName: ownerUser.displayName,
        ownerUsername: ownerUser.username,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.channelMembers.userId),
      )
      .leftJoin(
        schema.bots,
        eq(schema.bots.userId, schema.channelMembers.userId),
      )
      .leftJoin(ownerUser, eq(ownerUser.id, schema.bots.ownerId))
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    return result.map((row) => ({
      id: row.id,
      userId: row.userId,
      role: row.role,
      isMuted: row.isMuted,
      notificationsEnabled: row.notificationsEnabled,
      joinedAt: row.joinedAt,
      user: {
        ...this.mapChannelUserSummary(row),
        createdAt: row.createdAt,
      },
    }));
  }

  async updateMember(
    channelId: string,
    userId: string,
    dto: UpdateMemberDto,
    requesterId: string,
  ): Promise<void> {
    // Only owner can change roles; use effective role to cover mentor-derived ownership
    if (dto.role) {
      const tenantId = await this.getChannelTenantId(channelId);
      const requesterRole = tenantId
        ? await this.getEffectiveRole(channelId, requesterId, tenantId)
        : await this.getMemberRole(channelId, requesterId);
      if (requesterRole !== 'owner') {
        throw new ForbiddenException('Only owner can change roles');
      }
    }

    await this.db
      .update(schema.channelMembers)
      .set(dto)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    if (dto.role) {
      await this.redis.invalidate(
        REDIS_KEYS.CHANNEL_MEMBER_ROLE(channelId, userId),
      );
    }
  }

  async getChannelMemberIds(channelId: string): Promise<string[]> {
    const members = await this.db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    return members.map((m) => m.userId);
  }

  /**
   * Archive a channel (soft delete)
   */
  async archiveChannel(
    channelId: string,
    requesterId: string,
  ): Promise<ChannelResponse> {
    // Get channel first (needed for type check below and tenantId for auth)
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // Check permission using effective role (includes mentor-derived access)
    const role = channel.tenantId
      ? await this.getEffectiveRole(channelId, requesterId, channel.tenantId)
      : await this.getMemberRole(channelId, requesterId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException(
        'Insufficient permissions to archive channel',
      );
    }
    if (channel.type === 'direct' || channel.type === 'echo') {
      throw new ForbiddenException('Cannot archive direct message channels');
    }

    const [updated] = await this.db
      .update(schema.channels)
      .set({
        isArchived: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, channelId))
      .returning();

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));

    return updated;
  }

  /**
   * System helper to archive a routine-session channel (purpose: creation,
   * reflection, retrospective, etc.).
   *
   * Unlike archiveChannel, this method:
   * - Does NOT enforce owner/admin role (system-initiated)
   * - Only ACCEPTS channels with type='routine-session'. Other types throw
   *   ForbiddenException — the Phase 1 DM-reuse path is gone and the
   *   helper must not silently archive arbitrary channels.
   * - Is idempotent: no-op if channel missing or already archived
   */
  async archiveCreationChannel(
    channelId: string,
    tenantId?: string,
  ): Promise<void> {
    const conditions = [eq(schema.channels.id, channelId)];
    if (tenantId) {
      conditions.push(eq(schema.channels.tenantId, tenantId));
    }

    const [channel] = await this.db
      .select({
        id: schema.channels.id,
        type: schema.channels.type,
        isArchived: schema.channels.isArchived,
      })
      .from(schema.channels)
      .where(and(...conditions))
      .limit(1);

    if (!channel) {
      this.logger.debug(
        `archiveCreationChannel: channel ${channelId} not found, skipping`,
      );
      return;
    }
    if (channel.type !== 'routine-session') {
      throw new ForbiddenException(
        `archiveCreationChannel only allowed on routine-session channels (got ${channel.type})`,
      );
    }
    if (channel.isArchived) {
      this.logger.debug(
        `archiveCreationChannel: channel ${channelId} already archived, skipping`,
      );
      return;
    }

    await this.db
      .update(schema.channels)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(...conditions));

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));
  }

  /**
   * Hard delete a routine-session channel.
   *
   * Cleans up audit log rows first (their FK has no cascade — see migration
   * notes on im_audit_logs.channel_id), then deletes the channel inside a
   * single transaction. The other FKs (members, messages, search index,
   * property definitions, views, etc.) all use onDelete: 'cascade' and are
   * removed automatically by the channel delete. im_files.channel_id is
   * set to NULL via its own ON DELETE SET NULL, also safe.
   */
  async hardDeleteRoutineSessionChannel(
    channelId: string,
    tenantId?: string,
  ): Promise<void> {
    const [channel] = await this.db
      .select({
        id: schema.channels.id,
        type: schema.channels.type,
        tenantId: schema.channels.tenantId,
      })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);

    if (!channel) {
      throw new NotFoundException(`Channel ${channelId} not found`);
    }
    if (tenantId && channel.tenantId !== tenantId) {
      throw new NotFoundException(
        `Channel ${channelId} not found in tenant ${tenantId}`,
      );
    }
    if (channel.type !== 'routine-session') {
      throw new ForbiddenException(
        `hardDeleteRoutineSessionChannel only allowed on routine-session channels (got ${channel.type})`,
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.auditLogs)
        .where(eq(schema.auditLogs.channelId, channelId));
      await tx.delete(schema.channels).where(eq(schema.channels.id, channelId));
    });

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));
  }

  /**
   * Deactivate a channel — sets isActivated=false, preventing further messages.
   * Used when agent execution ends to make the tracking channel read-only.
   * Also applicable to task channels when execution completes.
   * Returns a snapshot of the latest 3 messages and total message count.
   */
  async deactivateChannel(channelId: string): Promise<{
    snapshot: ChannelSnapshot;
  }> {
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (channel.type !== 'tracking' && channel.type !== 'task') {
      throw new ForbiddenException(
        'Only tracking and task channels can be deactivated',
      );
    }
    if (!channel.isActivated) {
      const defaultSnapshot: ChannelSnapshot = {
        totalMessageCount: 0,
        latestMessages: [],
      };

      // Already deactivated — return existing snapshot
      return {
        snapshot: channel.snapshot ?? defaultSnapshot,
      };
    }

    // Query latest 3 messages and total count
    const [latestMessages, countResult] = await Promise.all([
      this.db
        .select({
          id: schema.messages.id,
          content: schema.messages.content,
          metadata: schema.messages.metadata,
          createdAt: schema.messages.createdAt,
        })
        .from(schema.messages)
        .where(eq(schema.messages.channelId, channelId))
        .orderBy(desc(schema.messages.createdAt))
        .limit(3),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.messages)
        .where(eq(schema.messages.channelId, channelId)),
    ]);

    const snapshot = {
      totalMessageCount: countResult[0]?.count ?? 0,
      latestMessages: latestMessages.reverse().map((m) => ({
        ...m,
        metadata: m.metadata,
      })),
    };

    await this.db
      .update(schema.channels)
      .set({
        isActivated: false,
        snapshot: snapshot,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, channelId));

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));

    return { snapshot };
  }

  /**
   * Activate a channel — sets isActivated=true, allowing messages again.
   * Used to reactivate a previously deactivated tracking/task channel.
   */
  async activateChannel(channelId: string): Promise<void> {
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (channel.type !== 'tracking' && channel.type !== 'task') {
      throw new ForbiddenException(
        'Only tracking and task channels can be activated',
      );
    }
    if (channel.isActivated) return; // already activated

    await this.db
      .update(schema.channels)
      .set({ isActivated: true, updatedAt: new Date() })
      .where(eq(schema.channels.id, channelId));

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));
  }

  /**
   * Unarchive a channel
   */
  async unarchiveChannel(
    channelId: string,
    requesterId: string,
  ): Promise<ChannelResponse> {
    // Use effective role (includes mentor-derived access)
    const tenantId = await this.getChannelTenantId(channelId);
    const role = tenantId
      ? await this.getEffectiveRole(channelId, requesterId, tenantId)
      : await this.getMemberRole(channelId, requesterId);
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const [updated] = await this.db
      .update(schema.channels)
      .set({
        isArchived: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, channelId))
      .returning();

    if (!updated) {
      throw new NotFoundException('Channel not found');
    }

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));

    return updated;
  }

  /**
   * Delete a channel permanently
   */
  async deleteChannel(
    channelId: string,
    requesterId: string,
    confirmationName?: string,
  ): Promise<void> {
    // Only owner can delete; use effective role so mentor-derived owners can also delete
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    const effectiveRole = channel.tenantId
      ? await this.getEffectiveRole(channelId, requesterId, channel.tenantId)
      : await this.getMemberRole(channelId, requesterId);
    if (effectiveRole !== 'owner') {
      throw new ForbiddenException('Only owner can delete a channel');
    }

    if (channel.type === 'direct' || channel.type === 'echo') {
      throw new ForbiddenException('Cannot delete direct message channels');
    }

    // Verify confirmation name matches (Slack-style safety)
    if (confirmationName && channel.name !== confirmationName) {
      throw new ForbiddenException('Channel name confirmation does not match');
    }

    // Delete channel (cascades to members, messages, etc.)
    await this.db
      .delete(schema.channels)
      .where(eq(schema.channels.id, channelId));

    await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(channelId));
  }

  /**
   * Get all public channels in a workspace/tenant (for browsing)
   * Returns channels with membership status for the requesting user
   * Optimized: Uses subqueries to avoid N+1 query problem
   */
  async getPublicChannels(
    tenantId: string | undefined,
    userId: string,
  ): Promise<(ChannelResponse & { isMember: boolean; memberCount: number })[]> {
    const result = await this.db
      .select({
        id: schema.channels.id,
        tenantId: schema.channels.tenantId,
        name: schema.channels.name,
        description: schema.channels.description,
        type: schema.channels.type,
        avatarUrl: schema.channels.avatarUrl,
        createdBy: schema.channels.createdBy,
        sectionId: schema.channels.sectionId,
        order: schema.channels.order,
        isArchived: schema.channels.isArchived,
        isActivated: schema.channels.isActivated,
        snapshot: schema.channels.snapshot,
        createdAt: schema.channels.createdAt,
        updatedAt: schema.channels.updatedAt,
        memberCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM im_channel_members
          WHERE channel_id = im_channels.id
          AND left_at IS NULL
        )`,
        isMember: sql<boolean>`EXISTS (
          SELECT 1
          FROM im_channel_members
          WHERE channel_id = im_channels.id
          AND user_id = ${userId}
          AND left_at IS NULL
        )`,
      })
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.type, 'public'),
          eq(schema.channels.isArchived, false),
          tenantId ? eq(schema.channels.tenantId, tenantId) : undefined,
        ),
      );

    return result;
  }

  /**
   * Get public channel details (for non-members to preview)
   */
  async getPublicChannelPreview(
    channelId: string,
    userId: string,
  ): Promise<
    (ChannelResponse & { isMember: boolean; memberCount: number }) | null
  > {
    const [channel] = await this.db
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.id, channelId),
          eq(schema.channels.type, 'public'),
        ),
      )
      .limit(1);

    if (!channel) {
      return null;
    }

    // Use derivation-aware membership so a mentor-derived user is shown as a
    // member in the UI preview (spec §6.2 #2).
    const isMember = channel.tenantId
      ? await this.isChannelMember(channelId, userId, channel.tenantId)
      : await this.isMember(channelId, userId);
    const memberCount = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      )
      .then((result) => Number(result[0]?.count || 0));

    return {
      ...channel,
      isMember,
      memberCount,
    };
  }

  /**
   * Join a public channel (self-join)
   */
  async joinPublicChannel(channelId: string, userId: string): Promise<void> {
    const channel = await this.findById(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    if (channel.type !== 'public') {
      throw new ForbiddenException('Can only self-join public channels');
    }

    await this.addMember(channelId, userId, 'member');
  }

  /**
   * Normalize channel name (supports Unicode)
   */
  static normalizeChannelName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
      .substring(0, 80);
  }

  /**
   * Validate channel name
   */
  static validateChannelName(name: string): {
    valid: boolean;
    error?: string;
  } {
    if (!name || name.trim().length === 0) {
      return { valid: false, error: 'Channel name is required' };
    }
    if (name.length > 80) {
      return {
        valid: false,
        error: 'Channel name must be 80 characters or less',
      };
    }
    // Allow Unicode letters, numbers, hyphens, and underscores
    // Must start with a letter or number (Unicode-aware)
    if (!/^[\p{L}\p{N}][\p{L}\p{N}\-_]*$/u.test(name)) {
      return {
        valid: false,
        error: 'Channel name must start with a letter or number',
      };
    }
    return { valid: true };
  }

  /**
   * Check whether a user is a member of a given tenant.
   * Used by channel:observe to gate temporary subscriptions.
   */
  async isUserInTenant(userId: string, tenantId: string): Promise<boolean> {
    const result = await this.db
      .select({ id: schema.tenantMembers.id })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.userId, userId),
          eq(schema.tenantMembers.tenantId, tenantId),
          isNull(schema.tenantMembers.leftAt),
        ),
      )
      .limit(1);
    return result.length > 0;
  }

  /**
   * Set the showInDmSidebar flag for the current user's membership
   * in a direct or echo channel.
   */
  async setSidebarVisibility(
    channelId: string,
    userId: string,
    show: boolean,
    tenantId?: string,
  ): Promise<void> {
    const [channel] = await this.db
      .select({ id: schema.channels.id, type: schema.channels.type })
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.id, channelId),
          tenantId ? eq(schema.channels.tenantId, tenantId) : undefined,
        ),
      )
      .limit(1);

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.type !== 'direct' && channel.type !== 'echo') {
      throw new BadRequestException(
        'Sidebar visibility can only be changed for direct or echo channels',
      );
    }

    // Verify user is an active member of this channel
    const [member] = await this.db
      .select({ id: schema.channelMembers.id })
      .from(schema.channelMembers)
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
        ),
      )
      .limit(1);

    if (!member) {
      throw new ForbiddenException('Not a member of this channel');
    }

    await this.db
      .update(schema.channelMembers)
      .set({ showInDmSidebar: show })
      .where(eq(schema.channelMembers.id, member.id));
  }

  /**
   * Delete all DM channels that a user participates in.
   * Used during bot cleanup to remove orphaned direct channels.
   */
  async deleteDirectChannelsForUser(userId: string): Promise<number> {
    // Find all DM channel IDs where this user is a member
    const dmChannels = await this.db
      .select({ channelId: schema.channelMembers.channelId })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channelMembers.channelId, schema.channels.id),
      )
      .where(
        and(
          eq(schema.channelMembers.userId, userId),
          eq(schema.channels.type, 'direct'),
        ),
      );

    if (dmChannels.length === 0) return 0;

    const channelIds = dmChannels.map((c) => c.channelId);

    // Delete channels (cascades to channel_members, messages, etc.)
    await this.db
      .delete(schema.channels)
      .where(inArray(schema.channels.id, channelIds));

    // Invalidate Redis cache for each channel
    for (const id of channelIds) {
      await this.redis.invalidate(REDIS_KEYS.CHANNEL_CACHE(id));
    }

    return channelIds.length;
  }

  /**
   * Create a channel on behalf of a bot. The bot is inserted as `owner`.
   * If the bot has a mentor, the mentor is also inserted as `owner`.
   * Optional `memberUserIds` are validated for tenant membership in a single
   * query and inserted as `member`. All inserts happen inside a single
   * transaction that rolls back on any error.
   */
  async createChannelForBot(
    botUserId: string,
    tenantId: string,
    dto: CreateBotChannelDto,
  ): Promise<ChannelResponse> {
    const bot = await this.botService.getBotMentorId(botUserId);
    if (!bot) throw new NotFoundException('Bot not found');
    if (!bot.isActive) throw new ForbiddenException('Bot is inactive');

    const mentorId = bot.mentorId;

    const channel = await this.db.transaction(async (tx) => {
      // Insert the channel row and use the returned id for subsequent calls
      // so that tests can assert on the id from the mock's returning() value.
      const [channelRow] = await tx
        .insert(schema.channels)
        .values({
          id: uuidv7(),
          tenantId,
          name: dto.name,
          description: dto.description,
          type: dto.type,
          avatarUrl: dto.avatarUrl,
          sectionId: dto.sectionId,
          createdBy: botUserId,
        })
        .returning();

      const channelId = channelRow.id;

      // Add bot as owner
      await this.addMember(channelId, botUserId, 'owner', tx);

      // Add mentor as owner (if present and distinct from bot)
      if (mentorId && mentorId !== botUserId) {
        await this.addMember(channelId, mentorId, 'owner', tx);
      }

      // Dedupe memberUserIds, dropping bot and mentor ids before validation
      const seedIds = Array.from(
        new Set(
          (dto.memberUserIds ?? []).filter(
            (id) => id !== botUserId && id !== mentorId,
          ),
        ),
      );

      if (seedIds.length > 0) {
        // Validate existence + tenant scope in one query via tenantMembers.
        // A user id that is missing from im_users OR belongs to a different
        // tenant will not have a matching (tenantId, userId) row.
        const existing = await tx
          .select({ userId: schema.tenantMembers.userId })
          .from(schema.tenantMembers)
          .where(
            and(
              inArray(schema.tenantMembers.userId, seedIds),
              eq(schema.tenantMembers.tenantId, tenantId),
            ),
          );

        const existingIds = new Set(
          existing.map((u: { userId: string }) => u.userId),
        );
        const missing = seedIds.filter((id) => !existingIds.has(id));
        if (missing.length > 0) {
          throw new BadRequestException(
            `Invalid memberUserIds: ${missing.join(',')}`,
          );
        }

        for (const uid of seedIds) {
          await this.addMember(channelId, uid, 'member', tx);
        }
      }

      return channelRow;
    });

    // Seed built-in tabs AFTER the transaction commits so a transient
    // tab-seeding failure does not roll back the channel itself. This
    // mirrors the existing `create` method (user path) which also calls
    // seedBuiltinTabs outside the transaction.
    await this.tabsService.seedBuiltinTabs(channel.id);
    return channel;
  }
}
