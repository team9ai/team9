import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AhandHubWebhookController } from './ahand-webhook.controller.js';
import { AhandWebhookService } from './ahand-webhook.service.js';

describe('AhandHubWebhookController', () => {
  let controller: AhandHubWebhookController;
  let svc: Record<string, jest.Mock>;

  const body = {
    eventId: 'evt_abc',
    eventType: 'device.online',
    occurredAt: new Date().toISOString(),
    deviceId: 'a'.repeat(64),
    externalUserId: 'u1',
    data: {},
  } as any;

  function makeReq(rawBody: unknown = Buffer.from(JSON.stringify(body))) {
    return { rawBody, body } as any;
  }

  beforeEach(async () => {
    svc = {
      verifySignature: jest.fn<any>(),
      dedupe: jest.fn<any>().mockResolvedValue(true),
      handleEvent: jest.fn<any>().mockResolvedValue(undefined),
      clearDedupe: jest.fn<any>().mockResolvedValue(undefined),
    };
    const mod = await Test.createTestingModule({
      controllers: [AhandHubWebhookController],
      providers: [{ provide: AhandWebhookService, useValue: svc }],
    }).compile();
    controller = mod.get(AhandHubWebhookController);
  });

  it('happy path: verifies, dedupes, processes, returns void (204)', async () => {
    await expect(
      controller.ingest(makeReq(), 'sha256=sig', '1234567890', 'evt_abc', body),
    ).resolves.toBeUndefined();
    expect(svc.verifySignature).toHaveBeenCalled();
    expect(svc.dedupe).toHaveBeenCalledWith('evt_abc');
    expect(svc.handleEvent).toHaveBeenCalledWith(body);
  });

  it('uses req.body string fallback when rawBody is absent', async () => {
    const req = { body: JSON.stringify(body) } as any;
    await expect(
      controller.ingest(req, 'sha256=sig', 'ts', 'evt_abc', body),
    ).resolves.toBeUndefined();
    expect(svc.verifySignature).toHaveBeenCalled();
  });

  it('throws BadRequest when rawBody is absent and req.body is a parsed object', async () => {
    const req = { body } as any;
    await expect(
      controller.ingest(req, 'sha256=sig', 'ts', 'evt_abc', body),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequest when body is null/undefined', async () => {
    const req = { rawBody: undefined, body: undefined } as any;
    await expect(
      controller.ingest(req, 'sha256=sig', 'ts', 'evt_abc', body),
    ).rejects.toThrow(BadRequestException);
    expect(svc.verifySignature).not.toHaveBeenCalled();
  });

  it('skips processing on duplicate event (dedupe returns false)', async () => {
    svc.dedupe.mockResolvedValue(false);
    await expect(
      controller.ingest(makeReq(), 'sha256=sig', 'ts', 'evt_abc', body),
    ).resolves.toBeUndefined();
    expect(svc.handleEvent).not.toHaveBeenCalled();
  });

  it('throws BadRequest when header eventId mismatches body eventId', async () => {
    await expect(
      controller.ingest(makeReq(), 'sha256=sig', 'ts', 'evt_DIFFERENT', body),
    ).rejects.toThrow(BadRequestException);
    expect(svc.handleEvent).not.toHaveBeenCalled();
  });

  it('clears dedupe key and rethrows when handleEvent throws', async () => {
    svc.handleEvent.mockRejectedValue(
      new InternalServerErrorException('db down'),
    );
    await expect(
      controller.ingest(makeReq(), 'sha256=sig', 'ts', 'evt_abc', body),
    ).rejects.toThrow(InternalServerErrorException);
    expect(svc.clearDedupe).toHaveBeenCalledWith('evt_abc');
  });

  it('skips header check when eventIdHeader is absent', async () => {
    await expect(
      controller.ingest(makeReq(), 'sha256=sig', 'ts', undefined, body),
    ).resolves.toBeUndefined();
    expect(svc.handleEvent).toHaveBeenCalled();
  });

  it('handles string body (non-Buffer) via JSON.stringify fallback', async () => {
    const req = { rawBody: '{"raw":true}' } as any;
    await expect(
      controller.ingest(req, 'sha256=sig', 'ts', 'evt_abc', body),
    ).resolves.toBeUndefined();
    expect(svc.verifySignature).toHaveBeenCalled();
  });

  it('throws BadRequest when rawBody is non-Buffer non-string object', async () => {
    const req = { rawBody: { raw: true } } as any;
    await expect(
      controller.ingest(req, 'sha256=sig', 'ts', 'evt_abc', body),
    ).rejects.toThrow(BadRequestException);
  });
});
