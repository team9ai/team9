import { and, eq, inArray, isNull } from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { PostgresJsDatabase } from '@team9/database';
import type { BotService } from '../../bot/bot.service.js';

/**
 * The three possible roles a channel member can hold.
 * Ranked: owner > admin > member.
 */
export type ChannelRole = 'owner' | 'admin' | 'member';

const RANK: Record<ChannelRole, number> = { member: 0, admin: 1, owner: 2 };

/**
 * Returns the higher of two channel roles.
 * If one argument is null, returns the other.
 * If both are null, returns null.
 */
export function maxRole(
  a: ChannelRole | null,
  b: ChannelRole | null,
): ChannelRole | null {
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

export interface ResolveArgs {
  db: PostgresJsDatabase;
  /** Only `findActiveBotsByMentorId` is required — keeps the helper mockable. */
  botService: Pick<BotService, 'findActiveBotsByMentorId'>;
  userId: string;
  tenantId: string;
  channelId?: string;
}

/**
 * Resolve the effective channel role for a user when a specific channel is
 * requested. Returns the single highest role across direct membership and
 * mentor-derived membership, or null if the user has no membership.
 */
export async function resolveEffectiveMembership(
  args: ResolveArgs & { channelId: string },
): Promise<ChannelRole | null>;

/**
 * Resolve effective channel roles for a user across all channels in a tenant.
 * Returns an array of `{ channelId, role }` entries — one per channel — with
 * roles collapsed to the maximum across direct and mentor-derived sources.
 */
export async function resolveEffectiveMembership(
  args: ResolveArgs,
): Promise<Array<{ channelId: string; role: ChannelRole }>>;

export async function resolveEffectiveMembership(
  args: ResolveArgs,
): Promise<
  ChannelRole | null | Array<{ channelId: string; role: ChannelRole }>
> {
  const { db, botService, userId, tenantId, channelId } = args;

  // Fetch every active bot mentored by this user in this tenant.
  // `findActiveBotsByMentorId` already filters on isActive=true and tenantId,
  // so we do not duplicate those conditions here.
  const mentoredBots = await botService.findActiveBotsByMentorId(
    userId,
    tenantId,
  );
  const subjectUserIds = [userId, ...mentoredBots.map((b) => b.botUserId)];

  // Fetch all channel-member rows for the subject user ids scoped to the
  // tenant. We join `channels` to filter on `channels.tenantId` because
  // `im_channel_members` has no tenantId column of its own.
  const rows = await db
    .select({
      channelId: schema.channelMembers.channelId,
      userId: schema.channelMembers.userId,
      role: schema.channelMembers.role,
    })
    .from(schema.channelMembers)
    .innerJoin(
      schema.channels,
      eq(schema.channelMembers.channelId, schema.channels.id),
    )
    .where(
      and(
        inArray(schema.channelMembers.userId, subjectUserIds),
        eq(schema.channels.tenantId, tenantId),
        channelId ? eq(schema.channelMembers.channelId, channelId) : undefined,
        isNull(schema.channelMembers.leftAt),
      ),
    );

  // Collapse multiple rows for the same channel to the maximum role.
  const byChannel = new Map<string, ChannelRole>();
  for (const r of rows) {
    const current = byChannel.get(r.channelId) ?? null;
    const next = maxRole(current, r.role as ChannelRole);
    // maxRole(non-null, non-null) is always non-null; the cast is safe.
    byChannel.set(r.channelId, next as ChannelRole);
  }

  if (channelId !== undefined) {
    return byChannel.get(channelId) ?? null;
  }

  return Array.from(byChannel.entries()).map(([cId, role]) => ({
    channelId: cId,
    role,
  }));
}
