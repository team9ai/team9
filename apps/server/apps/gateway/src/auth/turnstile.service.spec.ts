import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { TurnstileService } from './turnstile.service.js';

describe('TurnstileService', () => {
  const originalEnv = process.env;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    fetchSpy = jest.spyOn(globalThis, 'fetch') as jest.SpiedFunction<
      typeof fetch
    >;
  });

  afterEach(() => {
    process.env = originalEnv;
    fetchSpy.mockRestore();
  });

  function mockSiteverify(body: Record<string, unknown>) {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  describe('constructor', () => {
    it('throws when APP_ENV=production and no secret is set', () => {
      process.env.APP_ENV = 'production';
      delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
      expect(() => new TurnstileService()).toThrow(
        /CLOUDFLARE_TURNSTILE_SECRET_KEY/,
      );
    });

    it('does not throw when APP_ENV=production and secret is set', () => {
      process.env.APP_ENV = 'production';
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'real-secret';
      expect(() => new TurnstileService()).not.toThrow();
    });

    it('does not throw when APP_ENV=development without secret', () => {
      process.env.APP_ENV = 'development';
      delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
      expect(() => new TurnstileService()).not.toThrow();
    });
  });

  describe('verify()', () => {
    it('skips verification and returns when secret is not configured (dev)', async () => {
      process.env.APP_ENV = 'development';
      delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
      const service = new TurnstileService();
      await expect(
        service.verify('anything', '1.2.3.4'),
      ).resolves.toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws BadRequest when token is empty and secret is configured', async () => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'secret';
      const service = new TurnstileService();
      await expect(service.verify(undefined, '1.2.3.4')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('calls siteverify with secret, token, and remoteip', async () => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'the-secret';
      mockSiteverify({ success: true });
      const service = new TurnstileService();
      await service.verify('the-token', '8.8.8.8');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      );
      const body = (init as RequestInit).body as URLSearchParams;
      expect(body.toString()).toContain('secret=the-secret');
      expect(body.toString()).toContain('response=the-token');
      expect(body.toString()).toContain('remoteip=8.8.8.8');
    });

    it('throws BadRequest with errorCodes on siteverify failure', async () => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'secret';
      mockSiteverify({
        success: false,
        'error-codes': ['invalid-input-response'],
      });
      const service = new TurnstileService();
      await expect(service.verify('bad', '1.2.3.4')).rejects.toMatchObject({
        response: {
          message: 'TURNSTILE_VERIFICATION_FAILED',
          errorCodes: ['invalid-input-response'],
        },
      });
    });

    it('resolves when siteverify returns success=true', async () => {
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'secret';
      mockSiteverify({ success: true });
      const service = new TurnstileService();
      await expect(service.verify('ok', '1.2.3.4')).resolves.toBeUndefined();
    });
  });
});
