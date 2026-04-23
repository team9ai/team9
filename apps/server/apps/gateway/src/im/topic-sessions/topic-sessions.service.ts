import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  inArray,
  isNull,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { ClawHiveService } from '@team9/claw-hive';
import { GatewayMQService } from '@team9/rabbitmq';
import { type PostBroadcastTask } from '@team9/shared';
import { ChannelsService } from '../channels/channels.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { ImWorkerGrpcClientService } from '../services/im-worker-grpc-client.service.js';
import { determineMessageType } from '../messages/message-utils.js';
import type {
  TopicSessionGroup,
  TopicSessionRecentEntry,
  TopicSessionResponse,
} from './dto/topic-session.response.js';

/**
 * Service responsible for the topic-session feature: one ephemeral
 * user-to-agent conversation per topic. The saga for create() is:
 *
 *   1. Validate bot is an active hive-managed agent; extract agentId.
 *   2. Check DM permission gate (personal-staff visibility).
 *   3. Pre-generate channelId (UUIDv7) + session id.
 *      sessionId = `team9/{tenant}/{agentId}/topic/{channelId}` — the
 *      contract with agent-pi — so the scopeId == channelId invariant
 *      holds at construction time without a follow-up write.
 *   4. Create the agent-pi session (with team9Context.scopeType='topic').
 *      On failure, abort early — no local state leaked yet.
 *   5. Create the topic-session channel + members atomically in team9 DB.
 *      On failure, compensate: delete the agent-pi session.
 *   6. Persist the initial user message via gRPC and kick post-broadcast.
 *      post-broadcast.service recognises type='topic-session' and forwards
 *      the message to agent-pi via sendInput on the same sessionId.
 *      On failure, compensate: drop local channel/members + delete session.
 *   7. Emit WS events (CHANNEL.CREATED + TOPIC_SESSION.CREATED) + the
 *      search-index event-emitter hook.
 *
 * Compensation is best-effort; we log rather than throw to avoid
 * masking the original failure the caller needs to see.
 */
@Injectable()
export class TopicSessionsService {
  private readonly logger = new Logger(TopicSessionsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clawHive: ClawHiveService,
    @Inject(forwardRef(() => ChannelsService))
    private readonly channels: ChannelsService,
    private readonly imWorkerGrpc: ImWorkerGrpcClientService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly ws: WebsocketGateway,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly gatewayMQ?: GatewayMQService,
  ) {}

  async create(params: {
    creatorId: string;
    tenantId: string | null;
    botUserId: string;
    initialMessage: string;
    model?: { provider: string; id: string };
    title?: string | null;
  }): Promise<TopicSessionResponse> {
    const { creatorId, tenantId, botUserId, initialMessage, model } = params;
    const title = params.title ?? null;

    // --- Step 1: resolve agentId from bot ---
    const [botRow] = await this.db
      .select({
        userId: schema.bots.userId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
        isActive: schema.bots.isActive,
        userType: schema.users.userType,
      })
      .from(schema.bots)
      .innerJoin(schema.users, eq(schema.bots.userId, schema.users.id))
      .where(eq(schema.bots.userId, botUserId))
      .limit(1);

    if (
      !botRow ||
      botRow.userType !== 'bot' ||
      !botRow.isActive ||
      botRow.managedProvider !== 'hive'
    ) {
      throw new BadRequestException(
        'Target user is not an active hive-managed agent',
      );
    }

    const agentId = (botRow.managedMeta as Record<string, unknown> | null)
      ?.agentId as string | undefined;
    if (!agentId || typeof agentId !== 'string') {
      throw new BadRequestException('Agent id not found on bot managedMeta');
    }

    // --- Step 2: DM permission gate (personal-staff visibility) ---
    await this.channels.assertDirectMessageAllowed(creatorId, botUserId);

    // --- Step 3: bind channelId ↔ sessionId ---
    const channelId = uuidv7();
    const sessionId = this.buildSessionId(tenantId, agentId, channelId);

    // --- Step 4: create agent-pi session ---
    try {
      await this.clawHive.createSession(
        agentId,
        {
          userId: creatorId,
          sessionId,
          ...(model ? { model } : {}),
          team9Context: {
            source: 'team9',
            scopeType: 'topic',
            scopeId: channelId,
            peerUserId: creatorId,
          },
        },
        tenantId ?? undefined,
      );
    } catch (err) {
      this.logger.error(
        `createSession failed for agent ${agentId} (topic channel ${channelId}): ${err}`,
      );
      throw err;
    }

    // --- Step 5: create channel + members in team9 DB ---
    let channel;
    try {
      channel = await this.channels.createTopicSessionChannel({
        creatorId,
        botUserId,
        tenantId,
        agentId,
        sessionId,
        title,
        channelId,
      });
    } catch (err) {
      this.logger.error(
        `createTopicSessionChannel failed (session ${sessionId}): ${err}`,
      );
      this.compensateSession(sessionId, tenantId);
      throw err;
    }

    // --- Step 6: send initial user message via gRPC ---
    const workspaceId = tenantId ?? '';
    let messageId: string;
    try {
      const clientMsgId = uuidv7();
      const messageType = determineMessageType(initialMessage, false);
      const result = await this.imWorkerGrpc.createMessage({
        clientMsgId,
        channelId,
        senderId: creatorId,
        content: initialMessage,
        type: messageType,
        workspaceId,
      });
      messageId = result.msgId;
    } catch (err) {
      this.logger.error(
        `createMessage failed on topic-session ${channelId}: ${err}`,
      );
      this.compensateChannel(channelId);
      this.compensateSession(sessionId, tenantId);
      throw err;
    }

    // Fire post-broadcast task synchronously: unread fan-out + agent
    // forwarding via pushToHiveBots (scope='topic'). We await the publish
    // (not the downstream processing) so a failure to hand off to MQ
    // surfaces as a 5xx to the caller — otherwise the user sees the
    // channel appear but the agent never replies, and we silently lose
    // the first-turn event.
    const task: PostBroadcastTask = {
      msgId: messageId,
      channelId,
      senderId: creatorId,
      workspaceId,
      broadcastAt: Date.now(),
    };

    if (!this.gatewayMQ?.isReady()) {
      // Message itself is already persisted, channel + session exist.
      // Surface the fan-out gap so the user retries instead of staring
      // at a silent topic — same contract as any other message send
      // when the worker queue is unavailable.
      this.logger.error(
        `GatewayMQService not ready — topic-session ${channelId} initial message persisted but not fanned out to bot`,
      );
      throw new Error(
        'Message queue is temporarily unavailable, please try again in a moment',
      );
    }

    try {
      await this.gatewayMQ.publishPostBroadcast(task);
      this.logger.log(
        `Topic session ${channelId} created (session ${sessionId}, msg ${messageId}); post-broadcast task published for agent ${agentId}`,
      );
    } catch (err) {
      this.logger.error(
        `publishPostBroadcast failed on topic-session ${channelId}: ${err}`,
      );
      throw new Error(
        'Failed to notify worker about the new message, please try again',
      );
    }

    // --- Step 7: WS + search-index events ---
    const payload: TopicSessionResponse = {
      channelId,
      sessionId,
      agentId,
      botUserId,
      title,
      createdAt: channel.createdAt.toISOString(),
    };

    // CHANNEL.CREATED so existing sidebar/react-query consumers see it
    // even before they learn about TOPIC_SESSION.* (useful during the
    // sidebar-rollout transition).
    await this.ws.sendToUser(creatorId, WS_EVENTS.CHANNEL.CREATED, channel);
    await this.ws.sendToUser(botUserId, WS_EVENTS.CHANNEL.CREATED, channel);
    await this.ws.sendToUser(
      creatorId,
      WS_EVENTS.TOPIC_SESSION.CREATED,
      payload,
    );

    this.eventEmitter.emit('channel.created', { channel });

    return payload;
  }

  /**
   * Return, for each agent the caller has any topic-session with, the
   * most recent `perAgent` sessions plus a pointer to the legacy direct
   * channel (if one exists). The sidebar calls this once per mount.
   */
  async listGrouped(
    userId: string,
    tenantId: string | undefined,
    perAgent: number,
  ): Promise<TopicSessionGroup[]> {
    // Find all topic-session channels the user is a member of.
    const topicChannels = await this.db
      .select({
        channelId: schema.channels.id,
        propertySettings: schema.channels.propertySettings,
        createdAt: schema.channels.createdAt,
        tenantId: schema.channels.tenantId,
      })
      .from(schema.channels)
      .innerJoin(
        schema.channelMembers,
        eq(schema.channelMembers.channelId, schema.channels.id),
      )
      .where(
        and(
          eq(schema.channels.type, 'topic-session'),
          eq(schema.channels.isArchived, false),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
          tenantId
            ? eq(schema.channels.tenantId, tenantId)
            : isNull(schema.channels.tenantId),
        ),
      );

    if (topicChannels.length === 0) {
      return this.listLegacyDirectOnly(userId, tenantId);
    }

    // For each channel find the bot member (the "other side").
    const channelIds = topicChannels.map((c) => c.channelId);
    const botMembers = await this.db
      .select({
        channelId: schema.channelMembers.channelId,
        botUserId: schema.channelMembers.userId,
      })
      .from(schema.channelMembers)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.channelMembers.userId),
      )
      .where(
        and(
          inArray(schema.channelMembers.channelId, channelIds),
          eq(schema.users.userType, 'bot'),
          isNull(schema.channelMembers.leftAt),
        ),
      );

    const channelToBot = new Map<string, string>();
    for (const m of botMembers) channelToBot.set(m.channelId, m.botUserId);

    // Last message per channel (for sort + preview timestamp).
    const lastMsgRows = await this.db
      .select({
        channelId: schema.messages.channelId,
        lastAt: sql<string>`max(${schema.messages.createdAt})`,
      })
      .from(schema.messages)
      .where(inArray(schema.messages.channelId, channelIds))
      .groupBy(schema.messages.channelId);
    const lastMsgByChannel = new Map<string, string>();
    for (const r of lastMsgRows)
      if (r.lastAt) lastMsgByChannel.set(r.channelId, String(r.lastAt));

    // Unread counts (reuse the denormalized columns on messages if present;
    // otherwise default to 0 and let the client refresh lazily).
    const unreadRows = await this.db
      .select({
        channelId: schema.userChannelReadStatus.channelId,
        unreadCount: schema.userChannelReadStatus.unreadCount,
      })
      .from(schema.userChannelReadStatus)
      .where(
        and(
          eq(schema.userChannelReadStatus.userId, userId),
          inArray(schema.userChannelReadStatus.channelId, channelIds),
        ),
      );
    const unreadByChannel = new Map<string, number>();
    for (const r of unreadRows)
      unreadByChannel.set(r.channelId, r.unreadCount ?? 0);

    // Collect bot user ids to look up display info + legacy direct channel.
    const botUserIds = [...new Set([...channelToBot.values()])];
    const botDisplayRows = await this.db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        username: schema.users.username,
        avatarUrl: schema.users.avatarUrl,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.users)
      .innerJoin(schema.bots, eq(schema.bots.userId, schema.users.id))
      .where(inArray(schema.users.id, botUserIds));
    const botDisplay = new Map<
      string,
      {
        displayName: string | null;
        username: string;
        avatarUrl: string | null;
        agentId: string;
      }
    >();
    for (const b of botDisplayRows) {
      const agentId = (b.managedMeta as Record<string, unknown> | null)
        ?.agentId as string | undefined;
      if (!agentId) continue;
      botDisplay.set(b.id, {
        displayName: b.displayName,
        username: b.username,
        avatarUrl: b.avatarUrl,
        agentId,
      });
    }

    // Legacy direct channels between this user and each bot, if any.
    const legacyRows = await this.db
      .select({
        channelId: schema.channels.id,
        otherUserId: schema.channelMembers.userId,
      })
      .from(schema.channels)
      .innerJoin(
        schema.channelMembers,
        eq(schema.channelMembers.channelId, schema.channels.id),
      )
      .where(
        and(
          eq(schema.channels.type, 'direct'),
          eq(schema.channels.isArchived, false),
          inArray(schema.channelMembers.userId, botUserIds),
          isNull(schema.channelMembers.leftAt),
          tenantId
            ? eq(schema.channels.tenantId, tenantId)
            : isNull(schema.channels.tenantId),
        ),
      );
    // Keep only channels that also contain the caller (real 1:1).
    const legacyCandidateIds = legacyRows.map((r) => r.channelId);
    const callerMembership = legacyCandidateIds.length
      ? await this.db
          .select({
            channelId: schema.channelMembers.channelId,
          })
          .from(schema.channelMembers)
          .where(
            and(
              inArray(schema.channelMembers.channelId, legacyCandidateIds),
              eq(schema.channelMembers.userId, userId),
              isNull(schema.channelMembers.leftAt),
            ),
          )
      : [];
    const callerChannelIds = new Set(callerMembership.map((m) => m.channelId));
    const legacyByBot = new Map<string, string>();
    for (const r of legacyRows) {
      if (!callerChannelIds.has(r.channelId)) continue;
      legacyByBot.set(r.otherUserId, r.channelId);
    }

    // Bucket topic channels by bot and sort by lastMessageAt desc.
    type Row = {
      channelId: string;
      botUserId: string;
      sessionId: string;
      title: string | null;
      lastMessageAt: string | null;
      unreadCount: number;
      createdAt: string;
    };
    const bucket = new Map<string, Row[]>();
    for (const ch of topicChannels) {
      const botUserId = channelToBot.get(ch.channelId);
      if (!botUserId) continue;
      const ts = (
        ch.propertySettings as {
          topicSession?: {
            sessionId?: string;
            title?: string | null;
          };
        } | null
      )?.topicSession;
      if (!ts?.sessionId) continue;
      const rows = bucket.get(botUserId) ?? [];
      rows.push({
        channelId: ch.channelId,
        botUserId,
        sessionId: ts.sessionId,
        title: ts.title ?? null,
        lastMessageAt: lastMsgByChannel.get(ch.channelId) ?? null,
        unreadCount: unreadByChannel.get(ch.channelId) ?? 0,
        createdAt: ch.createdAt.toISOString(),
      });
      bucket.set(botUserId, rows);
    }

    // Assemble groups for every bot seen in topic channels OR in legacy
    // direct channels (covers users that only have legacy DMs so far).
    const agentSet = new Set<string>([...bucket.keys(), ...legacyByBot.keys()]);

    const groups: TopicSessionGroup[] = [];
    for (const botUserId of agentSet) {
      const d = botDisplay.get(botUserId);
      if (!d) continue;
      const rowsForBot = (bucket.get(botUserId) ?? []).sort((a, b) => {
        const al = a.lastMessageAt ?? a.createdAt;
        const bl = b.lastMessageAt ?? b.createdAt;
        return bl.localeCompare(al);
      });
      const recent: TopicSessionRecentEntry[] = rowsForBot
        .slice(0, perAgent)
        .map((r) => ({
          channelId: r.channelId,
          sessionId: r.sessionId,
          title: r.title,
          lastMessageAt: r.lastMessageAt,
          unreadCount: r.unreadCount,
          createdAt: r.createdAt,
        }));
      groups.push({
        agentUserId: botUserId,
        agentId: d.agentId,
        agentDisplayName: d.displayName || d.username,
        agentAvatarUrl: d.avatarUrl,
        legacyDirectChannelId: legacyByBot.get(botUserId) ?? null,
        totalCount: rowsForBot.length,
        recentSessions: recent,
      });
    }

    // Sort groups by their most recent activity overall.
    groups.sort((a, b) => {
      const aMax =
        a.recentSessions[0]?.lastMessageAt ??
        a.recentSessions[0]?.createdAt ??
        '';
      const bMax =
        b.recentSessions[0]?.lastMessageAt ??
        b.recentSessions[0]?.createdAt ??
        '';
      return bMax.localeCompare(aMax);
    });

    return groups;
  }

  async delete(params: {
    userId: string;
    tenantId: string | null;
    channelId: string;
  }): Promise<void> {
    const { userId, tenantId, channelId } = params;

    const [row] = await this.db
      .select({
        id: schema.channels.id,
        type: schema.channels.type,
        isArchived: schema.channels.isArchived,
        propertySettings: schema.channels.propertySettings,
        createdBy: schema.channels.createdBy,
      })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);

    if (!row || row.type !== 'topic-session') {
      throw new NotFoundException('Topic session not found');
    }
    if (row.createdBy !== userId) {
      throw new ForbiddenException(
        'Only the creator can delete this topic session',
      );
    }

    const sessionId =
      (
        row.propertySettings as {
          topicSession?: { sessionId?: string };
        } | null
      )?.topicSession?.sessionId ?? null;

    if (!row.isArchived) {
      await this.db
        .update(schema.channels)
        .set({ isArchived: true, updatedAt: new Date() })
        .where(eq(schema.channels.id, channelId));
    }

    if (sessionId) {
      // Best-effort — agent-pi swallows 404 on its own, so any failure
      // here is worth logging but not propagating to the user.
      this.clawHive
        .deleteSession(sessionId, tenantId ?? undefined)
        .catch((err) =>
          this.logger.warn(
            `deleteSession(${sessionId}) best-effort failure: ${err}`,
          ),
        );
    }

    await this.ws.sendToUser(userId, WS_EVENTS.TOPIC_SESSION.DELETED, {
      channelId,
    });
  }

  private buildSessionId(
    tenantId: string | null,
    agentId: string,
    channelId: string,
  ): string {
    return `team9/${tenantId ?? ''}/${agentId}/topic/${channelId}`;
  }

  /**
   * Best-effort deletion of an orphan agent-pi session when the team9
   * side of the saga failed. Never throws — this runs in a `catch` path
   * and must not mask the original error.
   */
  private compensateSession(sessionId: string, tenantId: string | null): void {
    this.clawHive
      .deleteSession(sessionId, tenantId ?? undefined)
      .catch((err) =>
        this.logger.warn(
          `Compensation deleteSession(${sessionId}) failed: ${err}`,
        ),
      );
  }

  /**
   * Best-effort removal of a half-created topic-session channel when the
   * initial-message step failed. Executes outside the original tx so we
   * can't use FK cascade — do members first, then the channel row.
   */
  private compensateChannel(channelId: string): void {
    void (async () => {
      try {
        await this.db
          .delete(schema.channelMembers)
          .where(eq(schema.channelMembers.channelId, channelId));
        await this.db
          .delete(schema.channels)
          .where(eq(schema.channels.id, channelId));
      } catch (err) {
        this.logger.warn(
          `Compensation channel-cleanup(${channelId}) failed: ${err}`,
        );
      }
    })();
  }

  /**
   * Fallback path for users who have no topic sessions but do have
   * legacy direct channels with agents — so the sidebar can still show
   * their agent list on day one of the rollout.
   */
  private async listLegacyDirectOnly(
    userId: string,
    tenantId: string | undefined,
  ): Promise<TopicSessionGroup[]> {
    // Direct channels where the caller is a member and the other side is a bot.
    const directRows = await this.db
      .select({
        channelId: schema.channels.id,
        otherUserId: schema.channelMembers.userId,
      })
      .from(schema.channels)
      .innerJoin(
        schema.channelMembers,
        eq(schema.channelMembers.channelId, schema.channels.id),
      )
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.channelMembers.userId),
      )
      .where(
        and(
          eq(schema.channels.type, 'direct'),
          eq(schema.channels.isArchived, false),
          eq(schema.users.userType, 'bot'),
          isNull(schema.channelMembers.leftAt),
          tenantId
            ? eq(schema.channels.tenantId, tenantId)
            : isNull(schema.channels.tenantId),
        ),
      );
    if (directRows.length === 0) return [];

    const channelIds = directRows.map((r) => r.channelId);
    const callerMembership = await this.db
      .select({ channelId: schema.channelMembers.channelId })
      .from(schema.channelMembers)
      .where(
        and(
          inArray(schema.channelMembers.channelId, channelIds),
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
        ),
      );
    const callerChannels = new Set(callerMembership.map((r) => r.channelId));

    const byBot = new Map<string, string>();
    for (const r of directRows) {
      if (callerChannels.has(r.channelId)) {
        byBot.set(r.otherUserId, r.channelId);
      }
    }

    if (byBot.size === 0) return [];

    const botDisplayRows = await this.db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        username: schema.users.username,
        avatarUrl: schema.users.avatarUrl,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.users)
      .innerJoin(schema.bots, eq(schema.bots.userId, schema.users.id))
      .where(inArray(schema.users.id, [...byBot.keys()]));

    const groups: TopicSessionGroup[] = [];
    for (const b of botDisplayRows) {
      const agentId = (b.managedMeta as Record<string, unknown> | null)
        ?.agentId as string | undefined;
      if (!agentId) continue;
      groups.push({
        agentUserId: b.id,
        agentId,
        agentDisplayName: b.displayName || b.username,
        agentAvatarUrl: b.avatarUrl,
        legacyDirectChannelId: byBot.get(b.id) ?? null,
        totalCount: 0,
        recentSessions: [],
      });
    }
    return groups;
  }
}
