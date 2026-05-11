import {
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

type ChannelRow = {
  id: string;
  tenantId: string | null;
  type: string;
  propertySettings?: unknown;
};

type BotBindingRow = {
  botUserId: string | null;
  managedProvider: string | null;
  managedMeta: schema.ManagedMeta | null;
};

type RoutineSessionRow = BotBindingRow & {
  routineId: string;
  creationSessionId: string | null;
};

type RoutineExecutionRow = BotBindingRow & {
  executionId: string;
  routineId: string;
  taskcastTaskId: string | null;
  taskStatus: string;
};

@Injectable()
export class AgentSessionBindingService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async resolve(
    channelId: string,
    userId: string,
  ): Promise<AgentSessionBindingResponse> {
    const channel = await this.findChannel(channelId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const member = await this.findMembership(channelId, userId);
    if (!member) {
      throw new ForbiddenException('User is not a channel member');
    }

    if (channel.type === 'task') {
      return this.resolveRoutineExecution(channel);
    }

    if (channel.type === 'routine-session') {
      return this.resolveRoutineSession(channel);
    }

    const bot = await this.findChannelBot(channel.id);
    const kind = this.kindForChannelType(channel.type);
    return this.resolveBotChannel(channel, kind, bot);
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

  private async findMembership(
    channelId: string,
    userId: string,
  ): Promise<{ id: string } | null> {
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

    return (member as { id: string } | undefined) ?? null;
  }

  private async findChannelBot(
    channelId: string,
  ): Promise<BotBindingRow | null> {
    const [bot] = await this.db
      .select({
        botUserId: schema.bots.userId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.bots,
        eq(schema.bots.userId, schema.channelMembers.userId),
      )
      .where(
        and(
          eq(schema.channelMembers.channelId, channelId),
          isNull(schema.channelMembers.leftAt),
        ),
      )
      .limit(1);

    return (bot as BotBindingRow | undefined) ?? null;
  }

  private async resolveRoutineSession(
    channel: ChannelRow,
  ): Promise<AgentSessionBindingResponse> {
    const [routine] = await this.db
      .select({
        routineId: schema.routines.id,
        creationSessionId: schema.routines.creationSessionId,
        botUserId: schema.bots.userId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.routines)
      .leftJoin(schema.bots, eq(schema.bots.id, schema.routines.botId))
      .where(eq(schema.routines.creationChannelId, channel.id))
      .limit(1);

    const row = (routine as RoutineSessionRow | undefined) ?? null;
    if (!row) {
      return this.unsupported(channel, 'routine-creation', 'no_bot');
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
        taskcastTaskId: schema.routineExecutions.taskcastTaskId,
        taskStatus: schema.routineExecutions.status,
        botUserId: schema.bots.userId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.routineExecutions)
      .innerJoin(
        schema.routines,
        eq(schema.routines.id, schema.routineExecutions.routineId),
      )
      .leftJoin(schema.bots, eq(schema.bots.id, schema.routines.botId))
      .where(eq(schema.routineExecutions.channelId, channel.id))
      .limit(1);

    const row = (execution as RoutineExecutionRow | undefined) ?? null;
    if (!row) {
      return this.unsupported(
        channel,
        'routine-execution',
        'session_not_created',
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
    bot: BotBindingRow | null,
  ): AgentSessionBindingResponse {
    const topicSession = this.getTopicSessionSettings(channel);
    const settingsAgentId = topicSession?.agentId ?? null;
    const settingsSessionId = topicSession?.sessionId ?? null;

    if (!bot) {
      if (
        settingsAgentId &&
        settingsSessionId &&
        channel.type === 'topic-session'
      ) {
        return {
          ...this.base(channel, 'topic-session'),
          supported: true,
          agentId: settingsAgentId,
          botUserId: null,
          sessionId: settingsSessionId,
        };
      }

      return this.unsupported(channel, kind, 'no_bot');
    }

    const unsupported = this.getUnsupportedReason(bot);
    if (unsupported && !(settingsAgentId && settingsSessionId)) {
      return this.unsupported(channel, kind, unsupported, bot);
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
}
