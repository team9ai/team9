import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '@team9/auth';
import { CapabilityHubClient } from './capability-hub.client.js';

// Headers that must be forwarded upstream for correct owner attribution.
const FORWARD_HEADERS = ['authorization', 'x-tenant-id'];

function pickHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of FORWARD_HEADERS) {
    const v = req.headers[h];
    if (typeof v === 'string') out[h] = v;
  }
  return out;
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
@UseGuards(AuthGuard)
export class DeepResearchController {
  constructor(private readonly hub: CapabilityHubClient) {}

  @Post()
  async create(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const upstream = await this.hub.request(
      'POST',
      '/api/deep-research/tasks',
      {
        headers: {
          ...pickHeaders(req),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    await passThrough(res, upstream);
  }

  @Get()
  async list(
    @Req() req: Request,
    @Res() res: Response,
    @Query() _query: Record<string, string>,
  ): Promise<void> {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const upstream = await this.hub.request(
      'GET',
      `/api/deep-research/tasks${qs}`,
      { headers: pickHeaders(req) },
    );
    await passThrough(res, upstream);
  }

  @Get(':id')
  async get(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
  ): Promise<void> {
    const upstream = await this.hub.request(
      'GET',
      `/api/deep-research/tasks/${encodeURIComponent(id)}`,
      { headers: pickHeaders(req) },
    );
    await passThrough(res, upstream);
  }
}
