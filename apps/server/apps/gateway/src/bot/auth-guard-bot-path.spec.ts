import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@team9/auth';

type GuardedRequest = {
  headers: Record<string, unknown>;
  user?: unknown;
  tenantId?: string;
};

function makeContext(headers: Record<string, unknown>) {
  const request: GuardedRequest = { headers };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { request, context };
}

describe('AuthGuard bot token branch', () => {
  let validateBotToken: jest.Mock<(...args: any[]) => any>;
  let guard: AuthGuard;

  beforeEach(() => {
    validateBotToken = jest.fn<any>();
    guard = new AuthGuard({ validateBotToken } as any);
  });

  it('populates request.user and request.tenantId from a valid bot token', async () => {
    validateBotToken.mockResolvedValue({
      sub: 'user-bot',
      email: 'bot@example.com',
      username: 'bot',
      tenantId: 'tenant-42',
    });

    const { request, context } = makeContext({
      authorization: 'Bearer t9bot_valid',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(validateBotToken).toHaveBeenCalledWith('t9bot_valid');
    expect(request.user).toEqual({
      sub: 'user-bot',
      email: 'bot@example.com',
      username: 'bot',
      tenantId: 'tenant-42',
    });
    expect(request.tenantId).toBe('tenant-42');
  });

  it('does not overwrite a tenantId already set by TenantMiddleware', async () => {
    validateBotToken.mockResolvedValue({
      sub: 'user-bot',
      email: 'bot@example.com',
      username: 'bot',
      tenantId: 'tenant-from-bot',
    });

    const { request, context } = makeContext({
      authorization: 'Bearer t9bot_valid',
    });
    request.tenantId = 'tenant-from-middleware';

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.tenantId).toBe('tenant-from-middleware');
  });

  it('throws UnauthorizedException for an invalid bot token', async () => {
    validateBotToken.mockResolvedValue(null);

    const { context } = makeContext({
      authorization: 'Bearer t9bot_invalid',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when no bot validator is injected', async () => {
    const barebonesGuard = new AuthGuard(undefined);
    const { context } = makeContext({
      authorization: 'Bearer t9bot_nope',
    });

    await expect(barebonesGuard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('leaves request.tenantId alone when the validator returns no tenantId', async () => {
    validateBotToken.mockResolvedValue({
      sub: 'user-bot',
      email: 'bot@example.com',
      username: 'bot',
    });

    const { request, context } = makeContext({
      authorization: 'Bearer t9bot_no_tenant',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.tenantId).toBeUndefined();
  });
});
