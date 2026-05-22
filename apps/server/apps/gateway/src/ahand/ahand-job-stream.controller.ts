import {
  Controller,
  Get,
  Logger,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '@team9/auth';
import { env } from '@team9/shared';
import type { Request, Response } from 'express';
import { AhandDevicesService } from './ahand.service.js';

@Controller({ path: 'ahand/jobs', version: '1' })
export class AhandJobStreamController {
  private readonly logger = new Logger(AhandJobStreamController.name);

  constructor(
    private readonly svc: AhandDevicesService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @Get(':hubJobId/stream')
  async streamJob(
    @Param('hubJobId') hubJobId: string,
    @Query('deviceId') deviceId: string | undefined,
    @Query('token') queryToken: string | undefined,
    @Query('lastEventId') queryLastEventId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const token = this.extractToken(req, queryToken);
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

    if (!deviceId) {
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }

    const hubBaseUrl =
      this.configService.get<string>('AHAND_HUB_URL') ?? env.AHAND_HUB_URL;
    if (!hubBaseUrl) {
      res.status(503).json({ error: 'ahand-hub is not configured' });
      return;
    }

    const { token: hubToken } = await this.svc.mintControlPlaneTokenForUser(
      userId,
      [deviceId],
    );

    const upstream = new URL(
      `/api/control/jobs/${encodeURIComponent(hubJobId)}/output`,
      hubBaseUrl,
    ).toString();
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${hubToken}`,
    };

    const lastEventId =
      this.firstHeader(req.headers['last-event-id']) ?? queryLastEventId;
    if (lastEventId) {
      headers['Last-Event-ID'] = lastEventId;
    }

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const upstreamRes = await fetch(upstream, {
        headers,
        signal: controller.signal,
      });

      if (!upstreamRes.ok || !upstreamRes.body) {
        this.logger.warn(
          `aHand upstream returned ${upstreamRes.status} for job ${hubJobId}`,
        );
        res.status(502).json({ error: 'aHand upstream unavailable' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const pump = async () => {
        try {
          await this.pipeSseRecords(upstreamRes.body!, res);
        } catch {
          // Client disconnects and aborts are expected for EventSource streams.
        }
      };

      void pump();
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      this.logger.error(`aHand job stream proxy error: ${String(error)}`);
      if (!res.headersSent) {
        res.status(502).json({ error: 'aHand upstream unavailable' });
      }
    }
  }

  private extractToken(
    req: Request,
    queryToken: string | undefined,
  ): string | undefined {
    return req.headers.authorization?.replace('Bearer ', '') || queryToken;
  }

  private firstHeader(
    value: string | string[] | undefined,
  ): string | undefined {
    return Array.isArray(value) ? value[0] : value;
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
          const forwarded = this.normalizeSseRecord(record);
          if (forwarded) this.writeSseRecord(res, forwarded);
          split = this.findRecordBoundary(buffer);
        }
      }

      if (buffer.length > 0) {
        const forwarded = this.normalizeSseRecord(buffer);
        if (forwarded) this.writeSseRecord(res, forwarded);
      }
    } finally {
      res.end();
      await reader.cancel?.().catch(() => undefined);
    }
  }

  private writeSseRecord(res: Response, record: string): void {
    if (res.destroyed) return;
    res.write(`${record}\n\n`);
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

  private normalizeSseRecord(record: string): string | null {
    if (record.trim().length === 0) return null;

    return record
      .split(/\r?\n/)
      .map((line) => {
        if (!line.startsWith('event:')) return line;
        const eventName = line.slice('event:'.length).trim();
        return `event: ${this.toTeam9EventName(eventName)}`;
      })
      .join('\n');
  }

  private toTeam9EventName(eventName: string): string {
    switch (eventName) {
      case 'stdout':
      case 'stderr':
      case 'progress':
      case 'finished':
      case 'error':
      case 'resync':
      case 'keepalive':
        return `job.${eventName}`;
      case 'stream_lagged':
      case 'history_trimmed':
      case 'lagged':
        return 'job.resync';
      case 'stream_error':
        return 'job.error';
      default:
        return eventName.startsWith('job.') ? eventName : `job.${eventName}`;
    }
  }
}
