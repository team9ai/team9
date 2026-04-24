import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  Logger,
  UseGuards,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { Type } from 'class-transformer';
import {
  IsObject,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AuthGuard, CurrentUser } from '@team9/auth';
import type { JwtPayload } from '@team9/auth';
import { env } from '@team9/shared';
import { ClawHiveService, type HiveModelRef } from '@team9/claw-hive';
import { ChannelsService } from './channels.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import {
  WS_EVENTS,
  type ChannelModelChangedEvent,
} from '../websocket/events/events.constants.js';

class ModelRefDto implements HiveModelRef {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  id!: string;
}

class UpdateChannelModelDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ModelRefDto)
  model!: ModelRefDto;
}

type ChannelModelSource = 'agent_default' | 'session_initial' | 'dynamic';

interface ChannelModelResponse {
  channelId: string;
  model: HiveModelRef;
  source: ChannelModelSource;
  /**
   * Present when a per-session override (initial or dynamic) exists.
   * Null when the effective model is falling through from `agentDefault`.
   */
  override: HiveModelRef | null;
}

@Controller({ path: 'im/channels', version: '1' })
export class ChannelModelController {
  private readonly logger = new Logger(ChannelModelController.name);
  private readonly hiveBaseUrl: string;
  private readonly hiveAuthToken: string;

  constructor(
    private readonly channelsService: ChannelsService,
    private readonly clawHiveService: ClawHiveService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    private readonly jwtService: JwtService,
  ) {
    this.hiveBaseUrl = env.CLAW_HIVE_API_URL ?? 'http://localhost:4100';
    this.hiveAuthToken = env.CLAW_HIVE_AUTH_TOKEN ?? '';
  }

  @Get(':channelId/model')
  @UseGuards(AuthGuard)
  async getModel(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelModelResponse> {
    const target = await this.channelsService.resolveModelSwitchTarget(
      channelId,
      userId,
    );

    const session = await this.clawHiveService.getSession(
      target.sessionId,
      target.tenantId ?? undefined,
    );

    if (!session) {
      // No session has been created on agent-pi yet (no messages have been
      // sent into this DM). Fall back to the agent's default model so the
      // UI can render a sensible initial state. The frontend will refetch
      // after the first message turn and pick up the real session.
      const agent = await this.clawHiveService.getAgent(
        target.agentId,
        target.tenantId ?? undefined,
      );
      if (!agent) {
        throw new NotFoundException('Agent not registered');
      }
      return {
        channelId,
        model: agent.model,
        source: 'agent_default',
        override: null,
      };
    }

    const resolution = session.modelResolution;
    const override =
      resolution.sessionDynamic ?? resolution.sessionInitial ?? null;

    return {
      channelId,
      model: resolution.effective,
      source: resolution.source,
      override,
    };
  }

  @Patch(':channelId/model')
  @UseGuards(AuthGuard)
  async updateModel(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: UpdateChannelModelDto,
  ): Promise<ChannelModelResponse> {
    // DTO shape is enforced by the global ValidationPipe + class-validator
    // decorators on UpdateChannelModelDto — no manual null-check needed.
    const target = await this.channelsService.resolveModelSwitchTarget(
      channelId,
      userId,
    );

    // `session.model_override` is handled by agent-pi's worker as a pure
    // state mutation — it does NOT run the agent or generate a reply. See
    // claw-hive-worker/src/session-factory.ts (dispatch on session.model_override).
    await this.clawHiveService.changeSessionModel(
      target.sessionId,
      dto.model,
      target.tenantId ?? undefined,
    );

    const changedAt = new Date().toISOString();
    const event: ChannelModelChangedEvent = {
      channelId,
      botId: target.bot.botUserId,
      model: dto.model,
      source: 'dynamic',
      changedBy: userId,
      changedAt,
    };
    await this.websocketGateway.sendToChannelMembers(
      channelId,
      WS_EVENTS.CHANNEL.MODEL_CHANGED,
      event,
    );

    return {
      channelId,
      model: dto.model,
      source: 'dynamic',
      override: dto.model,
    };
  }

  /**
   * Server-Sent Events proxy that forwards agent-pi's per-session event
   * stream to the browser, filtered to model- and thinking-level change
   * events. Mirrors the TaskCast SSE proxy pattern in
   * `routines-stream.controller.ts`.
   *
   * JWT is accepted via the `?token=` query param because the browser
   * `EventSource` cannot set custom headers.
   */
  @Get(':channelId/model-stream')
  async streamModel(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('token') queryToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const headerToken = req.headers.authorization?.replace('Bearer ', '');
    const token = headerToken || queryToken;

    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let userId: string;
    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        publicKey: env.JWT_PUBLIC_KEY,
        algorithms: ['ES256'],
      });
      userId = payload.sub;
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    let target: Awaited<
      ReturnType<ChannelsService['resolveModelSwitchTarget']>
    >;
    try {
      target = await this.channelsService.resolveModelSwitchTarget(
        channelId,
        userId,
      );
    } catch (err) {
      if (err instanceof ForbiddenException) {
        res.status(403).json({ error: err.message });
      } else if (err instanceof NotFoundException) {
        res.status(404).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'internal' });
      }
      return;
    }

    const upstream = `${this.hiveBaseUrl}/api/sessions/${encodeURIComponent(
      target.sessionId,
    )}/events`;
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'X-Hive-Auth': this.hiveAuthToken,
    };
    const lastEventId = req.headers['last-event-id'] as string | undefined;
    if (lastEventId) headers['Last-Event-ID'] = lastEventId;

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const upstreamRes = await fetch(upstream, {
        headers,
        signal: controller.signal,
      });

      if (!upstreamRes.ok || !upstreamRes.body) {
        this.logger.warn(
          `Hive SSE upstream ${upstreamRes.status} for session ${target.sessionId}`,
        );
        res.status(502).json({ error: 'Hive upstream unavailable' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Split on SSE record boundaries (blank line).
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
              const record = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const forwarded = this.filterSseRecord(record);
              if (forwarded) res.write(forwarded + '\n\n');
              boundary = buffer.indexOf('\n\n');
            }
          }
          // Flush any trailing record.
          if (buffer.length > 0) {
            const forwarded = this.filterSseRecord(buffer);
            if (forwarded) res.write(forwarded + '\n\n');
          }
        } catch {
          // client abort or upstream drop — expected
        } finally {
          res.end();
        }
      };

      void pump();
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      this.logger.error(`Hive SSE proxy error: ${error}`);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Hive upstream unavailable' });
      }
    }
  }

  /**
   * Return the SSE record unchanged if its `data:` line parses to an event
   * we care about (`model_change` or `thinking_level_change` — the literal
   * types emitted by agent-core's AgentSession event bus), a `ping`
   * heartbeat, or a retry directive. Everything else is dropped on the team9
   * side to avoid leaking internal agent events to the browser.
   */
  private filterSseRecord(record: string): string | null {
    const trimmed = record.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.startsWith(':')) return record; // comment / keepalive

    const dataLine = record
      .split('\n')
      .find((line) => line.startsWith('data:'));
    if (!dataLine) return record; // retry/id directives — forward as-is

    const raw = dataLine.slice('data:'.length).trim();
    if (raw === 'ping' || raw === '"ping"') return record;

    try {
      const parsed = JSON.parse(raw) as { type?: string };
      if (
        parsed.type === 'model_change' ||
        parsed.type === 'thinking_level_change'
      ) {
        return record;
      }
    } catch {
      // non-JSON payload — let it through
      return record;
    }
    return null;
  }
}
