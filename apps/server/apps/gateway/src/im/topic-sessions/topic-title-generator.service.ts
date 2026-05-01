import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  DATABASE_CONNECTION,
  and,
  asc,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { ChannelsService } from '../channels/channels.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { CapabilityHubClient } from '../../capability-hub/capability-hub.client.js';

interface MessageCreatedPayload {
  message: {
    id: string;
    channelId: string;
    senderId: string | null;
    content: string | null;
    type: string;
  };
  channel?: { id: string; type?: string } | null;
  sender?: { id: string; userType?: string; username?: string } | null;
}

// Keep the prompt language-agnostic and rely on the model to mirror the
// input language. Tight length constraints make sure the title fits the
// sidebar row.
const TITLE_PROMPT = `You are a concise title generator for a chat app's sidebar.

Given the user's first message in a conversation, produce a short title that summarises the topic.

Rules (ALL mandatory):
- Match the language of the input exactly (if the user wrote in Chinese, reply in Chinese; Japanese → Japanese; etc.).
- Max 12 characters for CJK scripts, OR max 6 words for Latin scripts. Keep it very short.
- No quotes, no trailing punctuation, no numbering, no prefix like "Title:".
- Output the title only. No explanations.`;

@Injectable()
export class TopicTitleGeneratorService {
  private readonly logger = new Logger(TopicTitleGeneratorService.name);

  /**
   * Channels whose title-generation call is in flight right now.
   * In-process dedupe only — the DB-level guard
   * (`expectCurrentTitleNull`) is what actually prevents double-writes
   * across restarts or multiple Node instances.
   */
  private readonly inflight = new Set<string>();

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Optional() private readonly hub?: CapabilityHubClient,
    @Inject(forwardRef(() => ChannelsService))
    private readonly channels?: ChannelsService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly ws?: WebsocketGateway,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * Listen for any freshly persisted message (human, bot, streaming end…)
   * and decide whether to generate a title for the channel it landed in.
   * The decision is "bot just replied in a topic-session channel whose
   * title is missing or still temporary" — exactly the first-turn-done
   * signal we want.
   */
  @OnEvent('message.created')
  async onMessageCreated(payload: MessageCreatedPayload): Promise<void> {
    try {
      await this.maybeGenerate(payload);
    } catch (err) {
      this.logger.error(
        `Title generation handler failed (channel ${payload?.message?.channelId ?? '?'}): ${err}`,
      );
    }
  }

  private async maybeGenerate(payload: MessageCreatedPayload): Promise<void> {
    const channelId = payload?.message?.channelId;
    const senderId = payload?.message?.senderId;
    if (!channelId || !senderId) return;
    if (!this.hub || !this.channels) return; // module wired without deps
    if (this.inflight.has(channelId)) return;

    // Only fire on bot-authored messages. If the sender info wasn't
    // included in the payload, fall back to a single lookup.
    let senderUserType = payload.sender?.userType;
    if (!senderUserType) {
      const [u] = await this.db
        .select({ userType: schema.users.userType })
        .from(schema.users)
        .where(eq(schema.users.id, senderId))
        .limit(1);
      senderUserType = u?.userType;
    }
    if (senderUserType !== 'bot') return;

    // Channel must be a topic session and its title must either be empty
    // or the first-message placeholder created before the AI summary.
    const [channel] = await this.db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);
    if (!channel || channel.type !== 'topic-session') return;

    const ts =
      (
        channel.propertySettings as {
          topicSession?: {
            title?: string | null;
            titleSource?: 'temporary' | 'manual' | 'generated';
          };
        } | null
      )?.topicSession ?? {};
    if (ts.title && ts.titleSource !== 'temporary') return;

    // capability-hub needs a billable identity (userId + tenantId) on
    // every LLM call so it can pre-authorize and then record usage
    // against the right workspace ledger. Skip generation cleanly when
    // the channel is missing either — no title is better than an
    // orphaned LLM charge or a blown-up fetch call.
    const creatorId = channel.createdBy;
    const tenantId = channel.tenantId;
    if (!creatorId || !tenantId) {
      this.logger.warn(
        `Skipping title gen for channel ${channelId}: missing createdBy or tenantId`,
      );
      return;
    }

    // Find the first human-authored message in the channel — that's the
    // seed for the summary.
    const firstUserMessage = await this.findFirstUserMessage(channelId);
    if (!firstUserMessage) return;

    this.inflight.add(channelId);
    try {
      const title = await this.callLlm(firstUserMessage, {
        userId: creatorId,
        tenantId,
      });
      if (!title) return;

      const updated = await this.channels.updateTopicSessionTitle(
        channelId,
        title,
        {
          expectCurrentTitleNull: true,
          allowTemporaryTitle: true,
          titleSource: 'generated',
        },
      );
      if (!updated) return;

      // Let the search indexer re-index under the new `channel.name`,
      // and notify sidebar listeners so the title slides in live.
      this.eventEmitter?.emit('channel.updated', { channel: updated });

      if (this.ws) {
        await this.ws.sendToUser(creatorId, WS_EVENTS.TOPIC_SESSION.UPDATED, {
          channelId,
          title,
        });
      }

      this.logger.log(
        `Generated title for topic session ${channelId}: "${title}"`,
      );
    } catch (err) {
      this.logger.error(
        `LLM title generation failed for channel ${channelId}: ${err}`,
      );
    } finally {
      this.inflight.delete(channelId);
    }
  }

  private async findFirstUserMessage(
    channelId: string,
  ): Promise<string | null> {
    const rows = await this.db
      .select({
        content: schema.messages.content,
        senderId: schema.messages.senderId,
      })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.users.id, schema.messages.senderId))
      .where(
        and(
          eq(schema.messages.channelId, channelId),
          eq(schema.messages.isDeleted, false),
          eq(schema.users.userType, 'human'),
        ),
      )
      .orderBy(asc(schema.messages.createdAt))
      .limit(1);

    const content = rows[0]?.content;
    if (!content) return null;
    // Clip egregiously long seeds so we don't burn context on a wall of
    // text — the first couple hundred chars are plenty to summarise from.
    return content.slice(0, 800);
  }

  private async callLlm(
    seed: string,
    identity: { userId: string; tenantId: string },
  ): Promise<string | null> {
    if (!this.hub) return null;

    // Route through capability-hub's llm-proxy, not the platform's
    // Anthropic SDK. That's the path agent-pi already uses and the
    // only one wired into pre-authorize / record / billing-hub —
    // calling Anthropic directly would bypass usage accounting.
    // OpenRouter-compatible OpenAI chat/completions body works
    // because capability-hub forwards unchanged.
    let response: Response;
    try {
      response = await this.hub.request(
        'POST',
        // capability-hub sets app.setGlobalPrefix('api'), so llm-proxy
        // lives at /api/proxy/:provider/*path.
        '/api/proxy/openrouter/chat/completions',
        {
          headers: {
            ...this.hub.serviceHeaders(identity),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'openai/gpt-4o-mini',
            max_tokens: 40,
            temperature: 0.3,
            messages: [
              { role: 'system', content: TITLE_PROMPT },
              { role: 'user', content: seed },
            ],
          }),
        },
      );
    } catch (err) {
      this.logger.warn(`capability-hub fetch failed: ${err}`);
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `capability-hub llm-proxy returned ${response.status}: ${body.slice(0, 200)}`,
      );
      return null;
    }

    let data: {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    try {
      data = (await response.json()) as typeof data;
    } catch (err) {
      this.logger.warn(`capability-hub response not JSON: ${err}`);
      return null;
    }

    const raw = (data.choices?.[0]?.message?.content ?? '').trim();
    if (!raw) return null;

    // Defensive post-processing: strip surrounding quotes / backticks,
    // collapse whitespace, and cap at a hard character ceiling in case
    // the model ignores the length guidance.
    const cleaned = raw
      .replace(/^[`'"“”‘’「『《]+|[`'"“”‘’」』》]+$/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[。！？!?.]+$/u, '')
      .trim();

    if (!cleaned) return null;
    // Rough upper bound: 40 chars works for both CJK (≈20 chars visible)
    // and Latin (≈8 words). Anything longer gets truncated.
    return cleaned.length > 40 ? cleaned.slice(0, 40) : cleaned;
  }
}
