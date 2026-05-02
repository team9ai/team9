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

  async findChannelOwnersAndAdmins(channelId: string): Promise<string[]> {
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

  async findBotOwnerAndMentor(botId: string): Promise<string[]> {
    const bot = await this.db.query.bots.findFirst({
      where: eq(bots.id, botId),
      columns: { ownerId: true, mentorId: true },
    });
    if (!bot) return [];
    return [bot.ownerId, bot.mentorId].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
  }

  /**
   * Returns the creator(s) of the routine.
   *
   * Note: the `routines` table only has a `creatorId` column (no `ownerId`).
   * A deduped set is returned for forward-compatibility if a second owner
   * field is ever added.
   */
  async findRoutineCreatorAndOwner(routineId: string): Promise<string[]> {
    const r = await this.db.query.routines.findFirst({
      where: eq(routines.id, routineId),
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
   */
  async findWikiOwners(wikiId: string): Promise<string[]> {
    const w = await this.db.query.workspaceWikis.findFirst({
      where: eq(workspaceWikis.id, wikiId),
      columns: { createdBy: true },
    });
    return w?.createdBy ? [w.createdBy] : [];
  }

  async findWorkspaceOwners(tenantId: string): Promise<string[]> {
    const rows = await this.db.query.tenantMembers.findMany({
      where: and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.role, 'owner'),
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
      ),
      columns: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}
