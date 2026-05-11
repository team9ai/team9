import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser, type JwtPayload } from '@team9/auth';
import { ClawHiveService } from '@team9/claw-hive';
import { env } from '@team9/shared';
import { AgentSessionBindingService } from './agent-session-binding.service.js';
import type {
  AgentSessionBindingResponse,
  AgentSessionStatus,
  SafeSessionComponentsResponse,
} from './agent-session.types.js';
import {
  filterAgentSessionEvent,
  projectSafeComponents,
} from './agent-session-redaction.js';

@Controller({ path: 'im/channels', version: '1' })
export class AgentSessionController {
  private readonly logger = new Logger(AgentSessionController.name);
  private readonly hiveBaseUrl: string;
  private readonly hiveAuthToken: string;

  constructor(
    private readonly bindingService: AgentSessionBindingService,
    private readonly clawHive: ClawHiveService,
    private readonly jwtService: JwtService,
  ) {
    this.hiveBaseUrl = env.CLAW_HIVE_API_URL ?? 'http://localhost:4100';
    this.hiveAuthToken = env.CLAW_HIVE_AUTH_TOKEN ?? '';
  }

  @Get(':channelId/agent-session')
  @UseGuards(AuthGuard)
  async getBinding(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<AgentSessionBindingResponse> {
    const binding = await this.bindingService.resolve(channelId, userId);
    if (!binding.supported || !binding.sessionId) return binding;

    return {
      ...binding,
      status: await this.getBestEffortStatus(binding),
    };
  }

  @Get(':channelId/agent-session/components')
  @UseGuards(AuthGuard)
  async getComponents(
    @CurrentUser('sub') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<SafeSessionComponentsResponse> {
    const binding = await this.bindingService.resolve(channelId, userId);
    if (!binding.supported || !binding.sessionId) {
      throw new NotFoundException('Agent session not available');
    }

    const response = await this.clawHive.getSessionComponents(
      binding.sessionId,
      binding.tenantId ?? undefined,
    );
    if (!response) {
      throw new NotFoundException('Agent session components not found');
    }

    return projectSafeComponents(response);
  }

  @Get(':channelId/agent-session/events')
  async streamEvents(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('token') queryToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const token = this.extractBearerToken(req) ?? queryToken;
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

    const binding = await this.bindingService.resolve(channelId, userId);
    if (!binding.supported || !binding.sessionId) {
      res.status(404).json({ error: 'Agent session not available' });
      return;
    }

    const upstream = `${this.hiveBaseUrl}/api/sessions/${encodeURIComponent(
      binding.sessionId,
    )}/events`;
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'X-Hive-Auth': this.hiveAuthToken,
    };
    if (binding.tenantId) headers['X-Hive-Tenant'] = binding.tenantId;
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
          `Hive session SSE upstream ${upstreamRes.status} for session ${binding.sessionId}`,
        );
        res.status(502).json({ error: 'Hive upstream unavailable' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      await this.pipeSseRecords(upstreamRes.body, res);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      this.logger.error(`Hive session SSE proxy error: ${error}`);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Hive upstream unavailable' });
      }
    }
  }

  private async getBestEffortStatus(
    binding: AgentSessionBindingResponse,
  ): Promise<AgentSessionStatus> {
    try {
      const status = await this.clawHive.getSessionStatus(
        binding.sessionId!,
        binding.tenantId ?? undefined,
      );
      if (!status) {
        return { exists: false, unavailableReason: 'not_found' };
      }

      const queueLength = status.queueLength ?? 0;
      const active = status.ownedBy !== null || queueLength > 0;
      return {
        exists: true,
        status: 'active',
        ownedBy: status.ownedBy,
        queueLength,
        activityState: active ? 'active' : 'inactive',
      };
    } catch {
      return { exists: false, unavailableReason: 'agent_pi_unavailable' };
    }
  }

  private extractBearerToken(req: Request): string | undefined {
    const authorization = req.headers.authorization;
    if (!authorization) return undefined;
    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) return undefined;
    return token;
  }

  private async pipeSseRecords(
    body: ReadableStream<Uint8Array>,
    res: Response,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let split = this.findRecordBoundary(buffer);
        while (split) {
          const record = buffer.slice(0, split.index);
          buffer = buffer.slice(split.index + split.length);
          const forwarded = this.filterSseRecord(record);
          if (forwarded) res.write(`${forwarded}\n\n`);
          split = this.findRecordBoundary(buffer);
        }
      }

      if (buffer.length > 0) {
        const forwarded = this.filterSseRecord(buffer);
        if (forwarded) res.write(`${forwarded}\n\n`);
      }
    } finally {
      res.end();
    }
  }

  private findRecordBoundary(
    buffer: string,
  ): { index: number; length: number } | null {
    const lf = buffer.indexOf('\n\n');
    const crlf = buffer.indexOf('\r\n\r\n');
    if (lf === -1 && crlf === -1) return null;
    if (lf === -1) return { index: crlf, length: 4 };
    if (crlf === -1) return { index: lf, length: 2 };
    return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
  }

  private filterSseRecord(record: string): string | null {
    const trimmed = record.trim();
    if (trimmed.length === 0) return null;

    const lines = record.split(/\r?\n/);
    const dataLines = lines.filter((line) => line.startsWith('data:'));
    if (dataLines.length === 0) return record;

    const rawData = dataLines
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n')
      .trim();
    if (rawData === 'ping' || rawData === '"ping"') return record;

    try {
      const parsed = JSON.parse(rawData) as Record<string, unknown>;
      const filtered = filterAgentSessionEvent(parsed);
      if (!filtered) return null;
      const directiveLines = lines.filter((line) => !line.startsWith('data:'));
      return [...directiveLines, `data: ${JSON.stringify(filtered)}`].join(
        '\n',
      );
    } catch {
      return null;
    }
  }
}
