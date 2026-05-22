import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AhandDevicesService } from './ahand.service.js';
import { AhandJobStreamController } from './ahand-job-stream.controller.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockReq(overrides: Partial<any> = {}) {
  return {
    headers: { authorization: undefined, 'last-event-id': undefined },
    on: jest.fn<any>(),
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {
    status: jest.fn<any>().mockReturnThis(),
    json: jest.fn<any>().mockReturnThis(),
    setHeader: jest.fn<any>(),
    flushHeaders: jest.fn<any>(),
    write: jest.fn<any>(),
    end: jest.fn<any>(),
    headersSent: false,
  };
  return res;
}

describe('AhandJobStreamController', () => {
  let controller: AhandJobStreamController;
  let jwtService: { verify: MockFn };
  let svc: { mintControlPlaneTokenForUser: MockFn };

  const USER_ID = 'user-1';

  beforeEach(async () => {
    process.env.JWT_PUBLIC_KEY = 'test-public-key';
    jwtService = { verify: jest.fn<any>().mockReturnValue({ sub: USER_ID }) };
    svc = {
      mintControlPlaneTokenForUser: jest.fn<any>().mockResolvedValue({
        token: 'hub-control-token',
        expiresAt: '2026-05-22T10:00:00.000Z',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AhandJobStreamController],
      providers: [
        { provide: AhandDevicesService, useValue: svc },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn<any>((key: string) =>
              key === 'AHAND_HUB_URL' ? 'https://hub.example.com' : undefined,
            ),
          },
        },
      ],
    }).compile();

    controller = module.get<AhandJobStreamController>(AhandJobStreamController);
  });

  it('authenticates query token, mints a device-scoped control-plane token, and streams aHand output', async () => {
    const reader = {
      read: jest
        .fn<any>()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            'id: 4\nevent: stdout\ndata: {"chunk":"hi"}\n\n',
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    const mockFetch = jest.fn<any>().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    });
    global.fetch = mockFetch as typeof fetch;

    const req = mockReq({
      headers: { 'last-event-id': '3' },
    });
    const res = mockRes();
    let resolveEnded: (() => void) | undefined;
    const ended = new Promise<void>((resolve) => {
      resolveEnded = resolve;
    });
    res.end = jest.fn<any>(() => {
      resolveEnded?.();
      return res;
    });

    await controller.streamJob(
      'hub-job-1',
      'hub-device-1',
      'query-token',
      undefined,
      req,
      res,
    );
    await ended;

    expect(jwtService.verify).toHaveBeenCalledWith('query-token', {
      publicKey: 'test-public-key',
      algorithms: ['ES256'],
    });
    expect(svc.mintControlPlaneTokenForUser).toHaveBeenCalledWith(USER_ID, [
      'hub-device-1',
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hub.example.com/api/control/jobs/hub-job-1/output',
      expect.objectContaining({
        headers: {
          Accept: 'text/event-stream',
          Authorization: 'Bearer hub-control-token',
          'Last-Event-ID': '3',
        },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(req.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream',
    );
    expect(res.write).toHaveBeenCalledWith(
      'id: 4\nevent: job.stdout\ndata: {"chunk":"hi"}\n\n',
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('returns 400 when deviceId is missing', async () => {
    const res = mockRes();

    await controller.streamJob(
      'hub-job-1',
      undefined,
      'query-token',
      undefined,
      mockReq(),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'deviceId is required' });
    expect(svc.mintControlPlaneTokenForUser).not.toHaveBeenCalled();
  });

  it('forwards query lastEventId when the EventSource header is absent', async () => {
    const reader = {
      read: jest.fn<any>().mockResolvedValueOnce({ done: true }),
    };
    const mockFetch = jest.fn<any>().mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    });
    global.fetch = mockFetch as typeof fetch;

    const res = mockRes();
    let resolveEnded: (() => void) | undefined;
    const ended = new Promise<void>((resolve) => {
      resolveEnded = resolve;
    });
    res.end = jest.fn<any>(() => {
      resolveEnded?.();
      return res;
    });

    await controller.streamJob(
      'hub-job-1',
      'hub-device-1',
      'query-token',
      '7',
      mockReq(),
      res,
    );
    await ended;

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Last-Event-ID': '7',
        }),
      }),
    );
  });
});
