import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  AgentSessionBindingKind,
  AgentSessionBindingResponse,
  AgentSessionUnsupportedReason,
} from './agent-session.types.js';
import { ChannelsService } from '../channels/channels.service.js';

type ChannelRow = {
  id: string;
  tenantId: string | null;
  type: string;
  propertySettings?: unknown;
};

type BotBindingRow = {
  botUserId: string | null;
  botTenantId?: string | null;
  managedProvider: string | null;
  managedMeta: schema.ManagedMeta | null;
};

type RoutineSessionRow = BotBindingRow & {
  routineId: string;
  routineTenantId?: string | null;
  creationSessionId: string | null;
};

type RoutineExecutionRow = BotBindingRow & {
  executionId: string;
  routineId: string;
  routineTenantId?: string | null;
  taskcastTaskId: string | null;
  taskStatus: string;
};

@Injectable()
export class AgentSessionBindingService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly channelsService: ChannelsService,
  ) {}

  async resolve(
    channelId: string,
    userId: string,
  ): Promise<AgentSessionBindingResponse> {
    const channel = await this.findChannel(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    await this.channelsService.assertReadAccess(channelId, userId);

    if (channel.type === 'task') {
      return this.resolveRoutineExecution(channel);
    }

    if (channel.type === 'routine-session') {
      return this.resolveRoutineSession(channel);
    }

    const bots = await this.findChannelBots(channel);
    const kind = this.kindForChannelType(channel.type);
    return this.resolveBotChannel(channel, kind, bots);
  }

  private async findChannel(channelId: string): Promise<ChannelRow | null> {
    const [channel] = await this.db
      .select({
        id: schema.channels.id,
        tenantId: schema.channels.tenantId,
        type: schema.channels.type,
        propertySettings: schema.channels.propertySettings,
      })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);

    return (channel as ChannelRow | undefined) ?? null;
  }

  private async findChannelBots(channel: ChannelRow): Promise<BotBindingRow[]> {
    const rows = await this.db
      .select({
        botUserId: schema.bots.userId,
        botTenantId: schema.installedApplications.tenantId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.channelMembers.userId),
      )
      .innerJoin(
        schema.bots,
        eq(schema.bots.userId, schema.channelMembers.userId),
      )
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .where(
        and(
          eq(schema.channelMembers.channelId, channel.id),
          isNull(schema.channelMembers.leftAt),
          eq(schema.users.userType, 'bot'),
          eq(schema.users.isActive, true),
          eq(schema.bots.isActive, true),
          channel.tenantId
            ? eq(schema.installedApplications.tenantId, channel.tenantId)
            : undefined,
        ),
      )
      .limit(2);

    return (rows as BotBindingRow[]).filter((row) =>
      this.botTenantMatches(channel, row),
    );
  }

  private async resolveRoutineSession(
    channel: ChannelRow,
  ): Promise<AgentSessionBindingResponse> {
    const routineSession = this.getRoutineSessionSettings(channel);
    const [routine] = await this.db
      .select({
        routineId: schema.routines.id,
        routineTenantId: schema.routines.tenantId,
        creationSessionId: schema.routines.creationSessionId,
        botUserId: schema.bots.userId,
        botTenantId: schema.installedApplications.tenantId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.routines)
      .leftJoin(schema.bots, eq(schema.bots.id, schema.routines.botId))
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .leftJoin(schema.users, eq(schema.users.id, schema.bots.userId))
      .where(
        and(
          eq(schema.routines.creationChannelId, channel.id),
          routineSession?.routineId
            ? eq(schema.routines.id, routineSession.routineId)
            : undefined,
          channel.tenantId
            ? eq(schema.routines.tenantId, channel.tenantId)
            : undefined,
          channel.tenantId
            ? eq(schema.installedApplications.tenantId, channel.tenantId)
            : undefined,
          eq(schema.users.userType, 'bot'),
          eq(schema.users.isActive, true),
          eq(schema.bots.isActive, true),
        ),
      )
      .limit(1);

    const row = (routine as RoutineSessionRow | undefined) ?? null;
    if (!row) {
      return this.unsupported(channel, 'routine-creation', 'no_bot');
    }
    if (
      !this.botTenantMatches(channel, row) ||
      !this.routineTenantMatches(channel, row) ||
      (routineSession?.routineId && row.routineId !== routineSession.routineId)
    ) {
      return this.unsupported(
        channel,
        'routine-creation',
        'session_not_created',
        row,
      );
    }

    const unsupported = this.getUnsupportedReason(row);
    if (unsupported) {
      return this.unsupported(channel, 'routine-creation', unsupported, row);
    }

    const agentId = row.managedMeta?.agentId ?? null;
    if (!row.creationSessionId) {
      return this.unsupported(
        channel,
        'routine-creation',
        'session_not_created',
        row,
      );
    }

    return {
      ...this.base(channel, 'routine-creation'),
      supported: true,
      agentId,
      botUserId: row.botUserId,
      sessionId: row.creationSessionId,
      routineId: row.routineId,
    };
  }

  private async resolveRoutineExecution(
    channel: ChannelRow,
  ): Promise<AgentSessionBindingResponse> {
    const [execution] = await this.db
      .select({
        executionId: schema.routineExecutions.id,
        routineId: schema.routineExecutions.routineId,
        routineTenantId: schema.routines.tenantId,
        taskcastTaskId: schema.routineExecutions.taskcastTaskId,
        taskStatus: schema.routineExecutions.status,
        botUserId: schema.bots.userId,
        botTenantId: schema.installedApplications.tenantId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.routineExecutions)
      .innerJoin(
        schema.routines,
        eq(schema.routines.id, schema.routineExecutions.routineId),
      )
      .leftJoin(schema.bots, eq(schema.bots.id, schema.routines.botId))
      .leftJoin(
        schema.installedApplications,
        eq(schema.bots.installedApplicationId, schema.installedApplications.id),
      )
      .leftJoin(schema.users, eq(schema.users.id, schema.bots.userId))
      .where(
        and(
          eq(schema.routineExecutions.channelId, channel.id),
          channel.tenantId
            ? eq(schema.routines.tenantId, channel.tenantId)
            : undefined,
          channel.tenantId
            ? eq(schema.installedApplications.tenantId, channel.tenantId)
            : undefined,
          eq(schema.users.userType, 'bot'),
          eq(schema.users.isActive, true),
          eq(schema.bots.isActive, true),
        ),
      )
      .limit(1);

    const row = (execution as RoutineExecutionRow | undefined) ?? null;
    if (!row) {
      return this.unsupported(
        channel,
        'routine-execution',
        'session_not_created',
      );
    }
    if (
      !this.botTenantMatches(channel, row) ||
      !this.routineTenantMatches(channel, row)
    ) {
      return this.unsupported(
        channel,
        'routine-execution',
        'session_not_created',
        row,
      );
    }

    const unsupported = this.getUnsupportedReason(row);
    if (unsupported) {
      return this.unsupported(channel, 'routine-execution', unsupported, row);
    }

    const agentId = row.managedMeta?.agentId ?? null;
    return {
      ...this.base(channel, 'routine-execution'),
      supported: true,
      agentId,
      botUserId: row.botUserId,
      sessionId: `team9/${channel.tenantId ?? ''}/${agentId}/routine/${row.executionId}`,
      routineId: row.routineId,
      executionId: row.executionId,
      taskcastTaskId: row.taskcastTaskId,
      taskStatus: row.taskStatus,
    };
  }

  private resolveBotChannel(
    channel: ChannelRow,
    kind: AgentSessionBindingKind | null,
    bots: BotBindingRow[],
  ): AgentSessionBindingResponse {
    const topicSession = this.getTopicSessionSettings(channel);
    const settingsAgentId = topicSession?.agentId ?? null;
    const settingsSessionId = topicSession?.sessionId ?? null;

    if (bots.length === 0) {
      return this.unsupported(channel, kind, 'no_bot');
    }

    const hiveBots = bots.filter((bot) => !this.getUnsupportedReason(bot));
    if (hiveBots.length > 1) {
      return this.unsupported(channel, kind, 'ambiguous_bot');
    }

    const bot = hiveBots[0] ?? bots[0];
    const unsupported = this.getUnsupportedReason(bot);
    if (unsupported) {
      return this.unsupported(channel, kind, unsupported, bot);
    }

    if (
      settingsSessionId &&
      (!settingsAgentId ||
        !this.isExpectedSessionId(
          channel,
          kind,
          settingsAgentId,
          settingsSessionId,
        ))
    ) {
      return this.unsupported(channel, kind, 'session_not_created', bot);
    }

    const agentId = settingsAgentId ?? bot.managedMeta?.agentId ?? null;
    const sessionId =
      settingsSessionId ?? this.buildSessionId(channel, kind, agentId);

    if (!agentId || !sessionId) {
      return this.unsupported(channel, kind, 'session_not_created', bot);
    }

    return {
      ...this.base(channel, kind),
      supported: true,
      agentId,
      botUserId: bot.botUserId,
      sessionId,
    };
  }

  private getUnsupportedReason(
    bot: BotBindingRow,
  ): AgentSessionUnsupportedReason | null {
    if (!bot.botUserId) return 'no_bot';
    if (bot.managedProvider !== 'hive' || !bot.managedMeta?.agentId) {
      return 'not_hive_managed';
    }
    return null;
  }

  private unsupported(
    channel: ChannelRow,
    kind: AgentSessionBindingKind | null,
    unsupportedReason: AgentSessionUnsupportedReason,
    bot?: Partial<BotBindingRow> | null,
  ): AgentSessionBindingResponse {
    return {
      ...this.base(channel, kind),
      supported: false,
      unsupportedReason,
      agentId: bot?.managedMeta?.agentId ?? null,
      botUserId: bot?.botUserId ?? null,
      sessionId: null,
    };
  }

  private base(
    channel: ChannelRow,
    kind: AgentSessionBindingKind | null,
  ): Omit<
    AgentSessionBindingResponse,
    'supported' | 'unsupportedReason' | 'agentId' | 'botUserId' | 'sessionId'
  > {
    return {
      channelId: channel.id,
      channelType: channel.type,
      kind,
      tenantId: channel.tenantId,
    };
  }

  private buildSessionId(
    channel: ChannelRow,
    kind: AgentSessionBindingKind | null,
    agentId: string | null,
  ): string | null {
    if (!agentId) return null;

    switch (kind) {
      case 'dm':
      case 'topic-session':
        return `team9/${channel.tenantId ?? ''}/${agentId}/dm/${channel.id}`;
      case 'tracking':
        return `team9/${channel.tenantId ?? ''}/${agentId}/tracking/${channel.id}`;
      default:
        return null;
    }
  }

  private kindForChannelType(type: string): AgentSessionBindingKind | null {
    switch (type) {
      case 'direct':
        return 'dm';
      case 'tracking':
        return 'tracking';
      case 'topic-session':
        return 'topic-session';
      default:
        return null;
    }
  }

  private getTopicSessionSettings(
    channel: ChannelRow,
  ): { agentId?: string; sessionId?: string } | null {
    const settings = channel.propertySettings as
      | { topicSession?: { agentId?: string; sessionId?: string } }
      | null
      | undefined;
    return settings?.topicSession ?? null;
  }

  private getRoutineSessionSettings(
    channel: ChannelRow,
  ): { purpose?: string; routineId?: string } | null {
    const settings = channel.propertySettings as
      | { routineSession?: { purpose?: string; routineId?: string } }
      | null
      | undefined;
    return settings?.routineSession ?? null;
  }

  private botTenantMatches(channel: ChannelRow, row: BotBindingRow): boolean {
    if (!channel.tenantId || row.botTenantId === undefined) return true;
    return row.botTenantId === channel.tenantId;
  }

  private routineTenantMatches(
    channel: ChannelRow,
    row: { routineTenantId?: string | null },
  ): boolean {
    if (!channel.tenantId || row.routineTenantId === undefined) return true;
    return row.routineTenantId === channel.tenantId;
  }

  private isExpectedSessionId(
    channel: ChannelRow,
    kind: AgentSessionBindingKind | null,
    agentId: string,
    sessionId: string,
  ): boolean {
    return sessionId === this.buildSessionId(channel, kind, agentId);
  }
}
