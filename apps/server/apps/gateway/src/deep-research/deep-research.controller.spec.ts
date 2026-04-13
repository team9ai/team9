import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import http from 'http';
import { INestApplication, VersioningType } from '@nestjs/common';
import { DeepResearchController } from './deep-research.controller.js';
import { CapabilityHubClient } from './capability-hub.client.js';
import { AuthGuard } from '@team9/auth';

describe('DeepResearchController (JSON passthrough)', () => {
  let app: INestApplication;
  let hub: { request: jest.Mock };

  beforeAll(async () => {
    hub = { request: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [DeepResearchController],
      providers: [
        { provide: CapabilityHubClient, useValue: hub },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'http://hub.test' },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(() => app.close());

  it('POST /api/v1/deep-research/tasks forwards body + headers', async () => {
    hub.request.mockResolvedValue(
      new Response(JSON.stringify({ id: 't1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await request(app.getHttpServer())
      .post('/api/v1/deep-research/tasks')
      .set('Authorization', 'Bearer T')
      .set('X-Tenant-Id', 'tnt')
      .send({ input: 'hi' })
      .expect(200);
    expect(res.body).toEqual({ id: 't1' });
    expect(hub.request).toHaveBeenCalledWith(
      'POST',
      '/api/deep-research/tasks',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer T',
          'x-tenant-id': 'tnt',
        }),
      }),
    );
  });

  it('GET /api/v1/deep-research/tasks forwards query string', async () => {
    hub.request.mockResolvedValue(
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await request(app.getHttpServer())
      .get('/api/v1/deep-research/tasks?status=running&limit=5')
      .set('Authorization', 'Bearer T')
      .set('X-Tenant-Id', 'tnt')
      .expect(200);
    expect(hub.request).toHaveBeenCalledWith(
      'GET',
      '/api/deep-research/tasks?status=running&limit=5',
      expect.any(Object),
    );
  });

  it('GET /api/v1/deep-research/tasks/:id passes through', async () => {
    hub.request.mockResolvedValue(
      new Response('{"id":"abc"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await request(app.getHttpServer())
      .get('/api/v1/deep-research/tasks/abc')
      .set('Authorization', 'Bearer T')
      .set('X-Tenant-Id', 'tnt')
      .expect(200, { id: 'abc' });
    expect(hub.request).toHaveBeenCalledWith(
      'GET',
      '/api/deep-research/tasks/abc',
      expect.any(Object),
    );
  });

  it('forwards 4xx status and body verbatim', async () => {
    hub.request.mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, error: { code: 'X', message: 'y' } }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      ),
    );
    await request(app.getHttpServer())
      .post('/api/v1/deep-research/tasks')
      .set('Authorization', 'Bearer T')
      .set('X-Tenant-Id', 'tnt')
      .send({ input: 'x' })
      .expect(429, { success: false, error: { code: 'X', message: 'y' } });
  });
});

describe('DeepResearchController (SSE passthrough)', () => {
  let app: INestApplication;
  let hub: { request: jest.Mock };

  // Build a WHATWG ReadableStream from an array of timed text chunks.
  function streamFrom(
    chunks: Array<{ delayMs: number; text: string }>,
  ): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
      async start(ctrl) {
        for (const c of chunks) {
          if (c.delayMs) await new Promise((r) => setTimeout(r, c.delayMs));
          ctrl.enqueue(enc.encode(c.text));
        }
        ctrl.close();
      },
    });
  }

  beforeAll(async () => {
    hub = { request: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [DeepResearchController],
      providers: [
        { provide: CapabilityHubClient, useValue: hub },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'http://hub.test' },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(() => app.close());

  it('streams upstream chunks in order and sets SSE headers', async () => {
    const chunk1 = 'event: interaction.start\ndata: {}\n\n';
    const chunk2 = 'event: content.delta\ndata: {"text":"hi"}\n\n';
    hub.request.mockResolvedValue(
      new Response(
        streamFrom([
          { delayMs: 0, text: chunk1 },
          { delayMs: 0, text: chunk2 },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
    );

    let bodyText = '';
    const res = await request(app.getHttpServer())
      .get('/api/v1/deep-research/tasks/abc/stream')
      .set('Authorization', 'Bearer T')
      .set('X-Tenant-Id', 'tnt')
      .set('Last-Event-ID', '0')
      .buffer(true)
      .parse((_res, callback) => {
        let data = '';
        _res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        _res.on('end', () => callback(null, data));
      });

    bodyText = res.body as string;

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(bodyText).toContain('event: interaction.start');
    expect(bodyText).toContain('event: content.delta');
    // Verify last-event-id was forwarded upstream.
    const callHeaders = (
      hub.request.mock.calls[0] as [
        string,
        string,
        { headers: Record<string, string> },
      ]
    )[2].headers;
    expect(callHeaders['last-event-id']).toBe('0');
  });

  it('writes a heartbeat within 25s when upstream is idle', async () => {
    hub.request.mockResolvedValue(
      new Response(
        streamFrom([{ delayMs: 25_000, text: 'event: done\ndata: {}\n\n' }]),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
    );

    const server = app.getHttpServer() as http.Server;
    // Ensure the server is bound to a port we can connect to.
    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.listen(0, resolve);
    });
    const addr = server.address() as { port: number };

    let accumulated = '';
    const clientReq = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/v1/deep-research/tasks/abc/stream',
      method: 'GET',
      headers: { Authorization: 'Bearer T' },
    });
    clientReq.end();

    // Collect chunks as they arrive via the live response stream.
    await new Promise<void>((resolve) => {
      clientReq.on('response', (res) => {
        res.on('data', (chunk: Buffer) => {
          accumulated += chunk.toString();
        });
        res.on('end', resolve);
        res.on('error', resolve);
      });
      clientReq.on('error', resolve);

      // After 22s assert heartbeat received, then destroy the connection.
      setTimeout(() => {
        expect(accumulated).toContain(': ping');
        clientReq.destroy();
        resolve();
      }, 22_000);
    });
  }, 30_000);

  it('aborts upstream when client disconnects', async () => {
    const upstreamAbort = jest.fn();
    hub.request.mockImplementation((...args: unknown[]) => {
      const opts = args[2] as { signal: AbortSignal };
      opts.signal.addEventListener('abort', upstreamAbort as EventListener);
      return Promise.resolve(
        new Response(
          streamFrom([{ delayMs: 5_000, text: 'event: done\ndata: {}\n\n' }]),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      );
    });

    const server = app.getHttpServer() as http.Server;
    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.listen(0, resolve);
    });
    const addr = server.address() as { port: number };

    const clientReq = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/v1/deep-research/tasks/abc/stream',
      method: 'GET',
      headers: { Authorization: 'Bearer T' },
    });
    clientReq.end();

    // Wait until server has flushed headers (connection established), then destroy.
    await new Promise<void>((resolve) => {
      clientReq.on('response', (_res) => {
        setTimeout(() => {
          clientReq.destroy();
          resolve();
        }, 100);
      });
      clientReq.on('error', resolve);
    });

    // Give the server time to propagate the close event and call ac.abort().
    await new Promise((r) => setTimeout(r, 200));
    expect(upstreamAbort).toHaveBeenCalled();
  });
});
