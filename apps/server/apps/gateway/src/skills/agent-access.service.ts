import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { SkillAgentAccess } from '@team9/database/schemas';

@Injectable()
export class SkillAgentAccessService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Resolve effective agent access for a (skill, bot) pair.
   *
   * v1: returns the per-skill default. If the skill is missing or
   * belongs to a different tenant, returns `'none'` so callers can
   * uniformly treat it as denial without branching on errors.
   *
   * v2 (out of scope, see spec §9): consult `skill_agent_access` table
   * for a per-agent override before falling back to the per-skill
   * default. Signature already accepts `botUserId` so call sites do
   * not need to change.
   */
  async resolve(
    skillId: string,
    _botUserId: string,
    tenantId: string,
  ): Promise<SkillAgentAccess> {
    const [row] = await this.db
      .select({ agentAccess: schema.skills.agentAccess })
      .from(schema.skills)
      .where(
        and(
          eq(schema.skills.id, skillId),
          eq(schema.skills.tenantId, tenantId),
        ),
      )
      .limit(1);

    return row?.agentAccess ?? 'none';
  }
}
