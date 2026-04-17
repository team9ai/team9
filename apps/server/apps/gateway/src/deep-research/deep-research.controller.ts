import {
  Body,
  Controller,
  Get,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '@team9/auth';
import { WorkspaceGuard } from '../workspace/guards/workspace.guard.js';
import { CapabilityHubClient } from './capability-hub.client.js';

// DI token for the SSE heartbeat interval. Tests override with a small value
// to exercise heartbeat behavior without real-time waits.
export const DEEP_RESEARCH_HEARTBEAT_MS = Symbol('DEEP_RESEARCH_HEARTBEAT_MS');
const DEFAULT_HEARTBEAT_MS = 20_000;

interface AuthenticatedRequest extends Request {
  user?: { sub: string };
  tenantId?: string;
}

function extractIdentity(req: AuthenticatedRequest): {
  userId: string;
  tenantId: string;
} {
  const userId = req.user?.sub;
  const tenantId =
    req.tenantId ??
    (typeof req.headers['x-tenant-id'] === 'string'
      ? req.headers['x-tenant-id']
      : undefined);
  if (!userId || !tenantId) {
    throw new Error('Deep-research request missing authenticated user context');
  }
  return { userId, tenantId };
}

async function passThrough(
  res: Response,
  upstream: globalThis.Response,
): Promise<void> {
  res.status(upstream.status);
  const ct: string | null = upstream.headers.get('content-type');
  if (ct) res.setHeader('content-type', ct);
  const text: string = await upstream.text();
  res.send(text);
}

@Controller({ path: 'deep-research/tasks', version: '1' })
@UseGuards(AuthGuard, WorkspaceGuard)
export class DeepResearchController {
  private readonly heartbeatMs: number;

  constructor(
    private readonly hub: CapabilityHubClient,
    @Optional() @Inject(DEEP_RESEARCH_HEARTBEAT_MS) heartbeatMs?: number,
  ) {
    this.heartbeatMs = heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  }

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const upstream = await this.hub.request(
      'POST',
      '/api/deep-research/tasks',
      {
        headers: {
          ...this.hub.serviceHeaders(extractIdentity(req)),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    await passThrough(res, upstream);
  }

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query() _query: Record<string, string>,
  ): Promise<void> {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const upstream = await this.hub.request(
      'GET',
      `/api/deep-research/tasks${qs}`,
      { headers: this.hub.serviceHeaders(extractIdentity(req)) },
    );
    await passThrough(res, upstream);
  }

  @Get(':id')
  async get(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Param('id') id: string,
  ): Promise<void> {
    const upstream = await this.hub.request(
      'GET',
      `/api/deep-research/tasks/${encodeURIComponent(id)}`,
      { headers: this.hub.serviceHeaders(extractIdentity(req)) },
    );
    await passThrough(res, upstream);
  }

  @Get(':id/stream')
  async stream(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Param('id') id: string,
  ): Promise<void> {
    const ac = new AbortController();
    req.on('close', () => ac.abort());

    const headers: Record<string, string> = {
      ...this.hub.serviceHeaders(extractIdentity(req)),
    };
    const lastEventId = req.headers['last-event-id'];
    if (typeof lastEventId === 'string') headers['last-event-id'] = lastEventId;
    headers['accept'] = 'text/event-stream';

    const upstream = await this.hub.request(
      'GET',
      `/api/deep-research/tasks/${encodeURIComponent(id)}/stream`,
      { headers, signal: ac.signal },
    );

    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type') ?? 'application/json';
      res.setHeader('content-type', ct);
      res.send(await upstream.text());
      return;
    }

    res.status(200);
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, this.heartbeatMs);

    try {
      for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        if (res.writableEnded) break;
        res.write(Buffer.from(chunk));
      }
    } catch {
      // Upstream aborted or errored; swallow — status already flushed.
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  }
}
