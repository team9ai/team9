import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';

/**
 * Verifies that a bot (identified by its shadow-user `userId`) manages a
 * specific claw-hive `agentId`.
 *
 * Used by the workspace-mount integration endpoints
 * (`POST /api/v1/bot/folder-map` and the `agent.*` / `session.*` paths
 * in `POST /api/v1/bot/folder-token`) to reject calls where the bot
 * tries to operate on an agent it doesn't actually own.
 *
 * ## Linking model
 *
 * For managed AI Staff bots (`hive`, `openclaw` providers), the link is
 * `bots.managedMeta.agentId` — set at staff-creation time
 * (`StaffService.createBotWithAgent` / openclaw bootstrap) and read back
 * in {@link routines.service.ts} and {@link personal-staff.service.ts}.
 * The `ManagedMeta` interface in {@link bots.ts} types this field as
 * an optional string.
 *
 * ## Rejected cases
 *
 * - Bot row not found OR `is_active=false` → `ForbiddenException`
 * - Bot row found but `managedMeta.agentId` missing/null/non-string →
 *   `ForbiddenException` (we cannot bind the bot to any agent)
 * - Bot row found but `managedMeta.agentId !== requested agentId` →
 *   `ForbiddenException`
 *
 * The exception messages avoid leaking which of the above conditions
 * tripped — every mismatch surfaces as the same generic 403 to keep
 * the bot↔agent topology unobservable to a caller wielding only its
 * own bot token.
 */
@Injectable()
export class BotAgentOwnership {
  private readonly logger = new Logger(BotAgentOwnership.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Throws `ForbiddenException` unless `botUserId` resolves to an active
   * bot whose `managedMeta.agentId` exactly equals `agentId`.
   */
  async assertAgentBelongsToBot(
    botUserId: string,
    agentId: string,
  ): Promise<void> {
    const rows = await this.db
      .select({
        userId: schema.bots.userId,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.bots)
      .where(
        and(eq(schema.bots.userId, botUserId), eq(schema.bots.isActive, true)),
      )
      .limit(1);

    const bot = rows[0];
    if (!bot) {
      this.logger.warn(
        `assertAgentBelongsToBot: no active bot for userId=${botUserId}`,
      );
      throw new ForbiddenException('agentId does not belong to caller bot');
    }

    const managedAgentId =
      bot.managedMeta &&
      typeof bot.managedMeta === 'object' &&
      typeof (bot.managedMeta as { agentId?: unknown }).agentId === 'string'
        ? (bot.managedMeta as { agentId: string }).agentId
        : null;

    if (!managedAgentId || managedAgentId !== agentId) {
      this.logger.warn(
        `assertAgentBelongsToBot: mismatch botUserId=${botUserId} requestedAgentId=${agentId} managedAgentId=${managedAgentId ?? '<none>'}`,
      );
      throw new ForbiddenException('agentId does not belong to caller bot');
    }
  }
}
