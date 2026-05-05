// apps/server/apps/gateway/src/permissions/permissions-approver.repository.ts
import { Injectable, Inject } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  isNull,
  DATABASE_CONNECTION,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import {
  channelMembers,
  channels,
  bots,
  routines,
  workspaceWikis,
  tenantMembers,
} from '@team9/database';

type Db = PostgresJsDatabase<typeof schema>;

@Injectable()
export class PermissionsApproverRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Db,
  ) {}

  async findChannelOwnersAndAdmins(
    channelId: string,
    tenantId: string,
  ): Promise<string[]> {
    // Verify channel belongs to the tenant before returning members
    const channel = await this.db.query.channels.findFirst({
      where: and(eq(channels.id, channelId), eq(channels.tenantId, tenantId)),
      columns: { id: true },
    });
    if (!channel) return [];

    const rows = await this.db.query.channelMembers.findMany({
      where: and(
        eq(channelMembers.channelId, channelId),
        inArray(channelMembers.role, ['owner', 'admin']),
        isNull(channelMembers.leftAt),
      ),
      columns: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /**
   * Returns the owner and mentor of the given bot.
   * Cross-tenant defense: only returns user IDs that are active members
   * of the specified tenant (bots have no direct tenantId column).
   */
  async findBotOwnerAndMentor(
    botId: string,
    tenantId: string,
  ): Promise<string[]> {
    const bot = await this.db.query.bots.findFirst({
      where: eq(bots.id, botId),
      columns: { ownerId: true, mentorId: true },
    });
    if (!bot) return [];
    const candidates = [bot.ownerId, bot.mentorId].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (!candidates.length) return [];
    // Verify candidates belong to the requested tenant
    const members = await this.db.query.tenantMembers.findMany({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        inArray(tenantMembers.userId, candidates),
        isNull(tenantMembers.leftAt),
      ),
      columns: { userId: true },
    });
    // Re-sort to preserve the original [ownerId, mentorId] order
    const memberSet = new Set(members.map((m) => m.userId));
    return candidates.filter((id) => memberSet.has(id));
  }

  /**
   * Returns the creator(s) of the routine.
   *
   * Note: the `routines` table only has a `creatorId` column (no `ownerId`).
   * A deduped set is returned for forward-compatibility if a second owner
   * field is ever added.
   */
  async findRoutineCreatorAndOwner(
    routineId: string,
    tenantId: string,
  ): Promise<string[]> {
    const r = await this.db.query.routines.findFirst({
      where: and(eq(routines.id, routineId), eq(routines.tenantId, tenantId)),
      columns: { creatorId: true },
    });
    if (!r) return [];
    const set = new Set<string>();
    if (r.creatorId) set.add(r.creatorId);
    return [...set];
  }

  /**
   * Returns the creator (createdBy) of the wiki as its "owner".
   *
   * Note: `workspace_wikis` stores `created_by` (text user ID) rather than a
   * typed `owner_id` UUID column. We return it as the wiki owner.
   * Cross-tenant defense: workspaceId == tenantId (FK to tenants.id).
   */
  async findWikiOwners(wikiId: string, tenantId: string): Promise<string[]> {
    const w = await this.db.query.workspaceWikis.findFirst({
      // workspaceId is the FK to tenants.id — it equals tenantId
      where: and(
        eq(workspaceWikis.id, wikiId),
        eq(workspaceWikis.workspaceId, tenantId),
      ),
      columns: { createdBy: true },
    });
    return w?.createdBy ? [w.createdBy] : [];
  }

  async findWorkspaceOwners(tenantId: string): Promise<string[]> {
    const rows = await this.db.query.tenantMembers.findMany({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.role, 'owner'),
        isNull(tenantMembers.leftAt),
      ),
      columns: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async findWorkspaceAdmins(tenantId: string): Promise<string[]> {
    const rows = await this.db.query.tenantMembers.findMany({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        inArray(tenantMembers.role, ['owner', 'admin']),
        isNull(tenantMembers.leftAt),
      ),
      columns: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}
