import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
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
