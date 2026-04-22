import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AhandHubClient } from './ahand-hub.client.js';

const BASE = 'https://hub.example.com';

function okResponse(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body: unknown = null): Response {
  // 204/205 forbid a body per the Fetch spec; feed null directly.
  if (status === 204 || status === 205) {
    return new Response(null, { status });
  }
  const text = body == null ? '' : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AhandHubClient', () => {
  let client: AhandHubClient;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.AHAND_HUB_URL = BASE;
    process.env.AHAND_HUB_SERVICE_TOKEN = 'svc_token_abcdef';
    fetchMock = jest.fn<any>();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new AhandHubClient();
  });

  afterEach(() => {
    delete process.env.AHAND_HUB_URL;
    delete process.env.AHAND_HUB_SERVICE_TOKEN;
  });

  // ─── isConfigured ────────────────────────────────────────────────────

  describe('isConfigured', () => {
    it('true when both env vars set', () => {
      expect(client.isConfigured()).toBe(true);
    });

    it('false when AHAND_HUB_URL missing', () => {
      delete process.env.AHAND_HUB_URL;
      expect(client.isConfigured()).toBe(false);
    });

    it('false when AHAND_HUB_SERVICE_TOKEN missing', () => {
      delete process.env.AHAND_HUB_SERVICE_TOKEN;
      expect(client.isConfigured()).toBe(false);
    });
  });

  describe('configuration guard', () => {
    it('requireConfig -> ServiceUnavailable when env missing', async () => {
      delete process.env.AHAND_HUB_URL;
      await expect(
        client.registerDevice({
          deviceId: 'x',
          publicKey: 'k',
          externalUserId: 'u',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ─── registerDevice ──────────────────────────────────────────────────

  describe('registerDevice', () => {
    it('POSTs to /api/admin/devices with service bearer + parses response', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ deviceId: 'abc', createdAt: '2026-04-22T10:00:00Z' }),
      );
      const res = await client.registerDevice({
        deviceId: 'abc',
        publicKey: 'pk',
        externalUserId: 'u1',
      });
      expect(res.deviceId).toBe('abc');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/api/admin/devices`);
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer svc_token_abcdef',
      );
      expect(JSON.parse(init.body as string)).toEqual({
        deviceId: 'abc',
        publicKey: 'pk',
        externalUserId: 'u1',
      });
    });

    it('409 -> ConflictException without retry', async () => {
      fetchMock.mockResolvedValue(errorResponse(409, { message: 'taken' }));
      const pending = client.registerDevice({
        deviceId: 'x',
        publicKey: 'p',
        externalUserId: 'u',
      });
      await expect(pending).rejects.toThrow(ConflictException);
      await expect(pending).rejects.toThrow('taken');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('403 -> ForbiddenException with fallback message when body lacks one', async () => {
      fetchMock.mockResolvedValue(errorResponse(403, {}));
      await expect(
        client.registerDevice({
          deviceId: 'x',
          publicKey: 'p',
          externalUserId: 'u',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('403 with non-string message falls back to default', async () => {
      // Defensive: hub returns {message: 42} (or any non-string).
      fetchMock.mockResolvedValue(errorResponse(403, { message: 42 }));
      const pending = client.registerDevice({
        deviceId: 'x',
        publicKey: 'p',
        externalUserId: 'u',
      });
      await expect(pending).rejects.toThrow(ForbiddenException);
      await expect(pending).rejects.toThrow('hub returned 403');
    });

    it('418 (unmapped 4xx) -> HttpException preserving status', async () => {
      fetchMock.mockResolvedValue(errorResponse(418, { message: 'teapot' }));
      await expect(
        client.registerDevice({
          deviceId: 'x',
          publicKey: 'p',
          externalUserId: 'u',
        }),
      ).rejects.toMatchObject({
        getStatus: expect.any(Function),
        message: 'teapot',
      });
    });

    it('malformed response shape -> InternalServerErrorException', async () => {
      fetchMock.mockResolvedValue(okResponse({ not: 'a device' }));
      await expect(
        client.registerDevice({
          deviceId: 'x',
          publicKey: 'p',
          externalUserId: 'u',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('non-JSON 2xx body still counts as malformed', async () => {
      fetchMock.mockResolvedValue(okResponse('<html>oops</html>', 200));
      await expect(
        client.registerDevice({
          deviceId: 'x',
          publicKey: 'p',
          externalUserId: 'u',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ─── mintDeviceToken ────────────────────────────────────────────────

  describe('mintDeviceToken', () => {
    it('POSTs TTL-carrying body', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ token: 'jwt.xxx', expiresAt: '2026-04-29T10:00:00Z' }),
      );
      const res = await client.mintDeviceToken({
        deviceId: 'abc',
        ttlSeconds: 604800,
      });
      expect(res.token).toBe('jwt.xxx');
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ ttlSeconds: 604800 });
    });

    it('omits body when ttlSeconds undefined', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ token: 't', expiresAt: '2026-04-29T10:00:00Z' }),
      );
      await client.mintDeviceToken({ deviceId: 'abc' });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({});
    });

    it('URL-encodes deviceId with special chars', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ token: 't', expiresAt: '2026-04-29T10:00:00Z' }),
      );
      await client.mintDeviceToken({ deviceId: 'a/b' });
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/api/admin/devices/a%2Fb/token`);
    });
  });

  // ─── mintControlPlaneToken ──────────────────────────────────────────

  describe('mintControlPlaneToken', () => {
    it('POSTs to /api/admin/control-plane/token', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ token: 'cp.xyz', expiresAt: '2026-04-22T11:00:00Z' }),
      );
      const res = await client.mintControlPlaneToken({
        externalUserId: 'u1',
        scope: 'jobs:execute',
      });
      expect(res.token).toBe('cp.xyz');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/api/admin/control-plane/token`);
      expect(JSON.parse(init.body as string)).toEqual({
        externalUserId: 'u1',
        scope: 'jobs:execute',
      });
    });
  });

  // ─── deleteDevice ───────────────────────────────────────────────────

  describe('deleteDevice', () => {
    it('DELETE with empty 204 body returns undefined', async () => {
      fetchMock.mockResolvedValue(errorResponse(204, null));
      await expect(client.deleteDevice('abc')).resolves.toBeUndefined();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/api/admin/devices/abc`);
      expect(init.method).toBe('DELETE');
      expect(init.body).toBeUndefined();
    });

    it('404 -> NotFoundException', async () => {
      fetchMock.mockResolvedValue(errorResponse(404, { message: 'nope' }));
      await expect(client.deleteDevice('abc')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allowEmptyBody always returns undefined (ignores body content)', async () => {
      // Defensive: if the hub ever returns a 200 JSON body for DELETE, our
      // `allowEmptyBody` flag short-circuits unconditionally and returns undefined.
      fetchMock.mockResolvedValue(okResponse({ ok: true }));
      await expect(client.deleteDevice('abc')).resolves.toBeUndefined();
    });
  });

  // ─── listDevicesForExternalUser ─────────────────────────────────────

  describe('listDevicesForExternalUser', () => {
    it('GET with query param, returns parsed array', async () => {
      fetchMock.mockResolvedValue(
        okResponse([{ deviceId: 'a' }, { deviceId: 'b' }]),
      );
      const res = await client.listDevicesForExternalUser('u1');
      expect(res).toHaveLength(2);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/api/admin/devices?externalUserId=u1`);
    });

    it('malformed response -> InternalServerErrorException', async () => {
      fetchMock.mockResolvedValue(okResponse('not an array'));
      await expect(client.listDevicesForExternalUser('u1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ─── Retry / timeout ────────────────────────────────────────────────

  describe('retry behaviour', () => {
    it('5xx then success: retries and returns on attempt 3', async () => {
      fetchMock
        .mockImplementationOnce(async () => errorResponse(503))
        .mockImplementationOnce(async () => errorResponse(502))
        .mockImplementationOnce(async () => okResponse({ deviceId: 'ok' }));
      const res = await client.registerDevice({
        deviceId: 'ok',
        publicKey: 'p',
        externalUserId: 'u',
      });
      expect(res).toMatchObject({ deviceId: 'ok' });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('three 5xx in a row -> ServiceUnavailableException', async () => {
      fetchMock.mockImplementation(async () => errorResponse(503));
      await expect(client.listDevicesForExternalUser('u')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('fetch rejecting (transport error) retries too', async () => {
      fetchMock
        .mockImplementationOnce(async () => {
          throw new Error('ECONNRESET');
        })
        .mockImplementationOnce(async () => {
          throw new Error('ECONNRESET');
        })
        .mockImplementationOnce(async () => okResponse([]));
      const res = await client.listDevicesForExternalUser('u');
      expect(res).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('HttpException thrown mid-request (from 4xx) is not retried', async () => {
      fetchMock.mockImplementation(async () =>
        errorResponse(403, { message: 'nope' }),
      );
      await expect(
        client.registerDevice({
          deviceId: 'x',
          publicKey: 'p',
          externalUserId: 'u',
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('exhausted retries with non-Error lastError still surface ServiceUnavailable', async () => {
      fetchMock.mockImplementation(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'weird string error';
      });
      await expect(client.listDevicesForExternalUser('u')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
