import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

// ─── Mock @team9/shared env ───────────────────────────────────────────────

const BASE = 'https://gateway.internal.test';
const TOKEN = 'svc_internal_token_long_enough';

const mockEnv = {
  GATEWAY_INTERNAL_URL: BASE,
  INTERNAL_AUTH_VALIDATION_TOKEN: TOKEN,
};

jest.unstable_mockModule('@team9/shared', () => ({ env: mockEnv }));

const { AhandControlPlaneClient } =
  await import('./ahand-control-plane.client.js');
type ClientType = InstanceType<typeof AhandControlPlaneClient>;

// ─── Helpers ─────────────────────────────────────────────────────────────

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errResponse(status: number, body: unknown = null): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(body == null ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AhandControlPlaneClient', () => {
  let client: ClientType;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.GATEWAY_INTERNAL_URL = BASE;
    mockEnv.INTERNAL_AUTH_VALIDATION_TOKEN = TOKEN;
    fetchMock = jest.fn<any>();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new AhandControlPlaneClient();
  });

  // ─── requireConfig guard ─────────────────────────────────────────────

  it('throws ServiceUnavailable when GATEWAY_INTERNAL_URL missing', async () => {
    mockEnv.GATEWAY_INTERNAL_URL = '';
    await expect(client.mintControlPlaneToken('u1')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws ServiceUnavailable when token missing', async () => {
    mockEnv.INTERNAL_AUTH_VALIDATION_TOKEN = '';
    await expect(client.listDevicesForUser('u1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  // ─── mintControlPlaneToken ───────────────────────────────────────────

  describe('mintControlPlaneToken', () => {
    it('POSTs with Bearer auth + returns parsed token', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ token: 'cp.xyz', expiresAt: '2026-04-22T11:00:00Z' }),
      );
      const res = await client.mintControlPlaneToken('u1', ['a'.repeat(64)]);
      expect(res.token).toBe('cp.xyz');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/internal/ahand/control-plane/token`);
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${TOKEN}`,
      );
      expect(JSON.parse(init.body as string)).toEqual({
        userId: 'u1',
        deviceIds: ['a'.repeat(64)],
      });
    });

    it('403 → ForbiddenException with message', async () => {
      fetchMock.mockImplementation(async () =>
        errResponse(403, { message: 'unowned device' }),
      );
      await expect(client.mintControlPlaneToken('u1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('403 with no message → fallback ForbiddenException', async () => {
      fetchMock.mockImplementation(async () => errResponse(403, {}));
      await expect(client.mintControlPlaneToken('u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('malformed response → InternalServerErrorException', async () => {
      fetchMock.mockResolvedValue(okResponse({ token: 42 }));
      await expect(client.mintControlPlaneToken('u1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('non-JSON 2xx → InternalServerErrorException', async () => {
      fetchMock.mockResolvedValue(okResponse('<html>bad</html>'));
      await expect(client.mintControlPlaneToken('u1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('4xx (not 403) → throws, does not retry', async () => {
      fetchMock.mockImplementation(async () => errResponse(400));
      await expect(client.mintControlPlaneToken('u1')).rejects.toThrow(Error);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ─── listDevicesForUser ──────────────────────────────────────────────

  describe('listDevicesForUser', () => {
    it('POSTs and decodes device array', async () => {
      fetchMock.mockResolvedValue(
        okResponse([
          {
            id: 'id-1',
            hubDeviceId: 'd1',
            publicKey: 'pk',
            nickname: 'A',
            platform: 'macos',
            hostname: null,
            status: 'active',
            isOnline: true,
            lastSeenAt: '2026-04-22T10:00:00Z',
            createdAt: '2026-04-22T09:00:00Z',
          },
        ]),
      );
      const res = await client.listDevicesForUser('u1');
      expect(res).toHaveLength(1);
      expect(res[0].hubDeviceId).toBe('d1');
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        userId: 'u1',
        includeOffline: true,
      });
    });

    it('passes includeOffline:false', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      await client.listDevicesForUser('u1', { includeOffline: false });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        userId: 'u1',
        includeOffline: false,
      });
    });
  });

  // ─── Retry ───────────────────────────────────────────────────────────

  describe('retry behaviour', () => {
    it('retries 5xx and succeeds on attempt 3', async () => {
      fetchMock
        .mockImplementationOnce(async () => errResponse(503))
        .mockImplementationOnce(async () => errResponse(502))
        .mockImplementationOnce(async () =>
          okResponse({ token: 'cp', expiresAt: 'e' }),
        );
      const res = await client.mintControlPlaneToken('u1');
      expect(res.token).toBe('cp');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('3×503 → ServiceUnavailableException', async () => {
      fetchMock.mockImplementation(async () => errResponse(503));
      await expect(client.mintControlPlaneToken('u1')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('transport error retries too', async () => {
      fetchMock
        .mockImplementationOnce(async () => {
          throw new Error('ECONNRESET');
        })
        .mockImplementationOnce(async () =>
          okResponse({ token: 'cp', expiresAt: 'e' }),
        );
      const res = await client.mintControlPlaneToken('u1');
      expect(res.token).toBe('cp');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('3 transport errors → ServiceUnavailableException with non-Error last error', async () => {
      fetchMock.mockImplementation(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'weird error';
      });
      await expect(client.mintControlPlaneToken('u1')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
