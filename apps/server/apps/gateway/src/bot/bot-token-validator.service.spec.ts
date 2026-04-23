import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BotTokenValidatorService } from './bot-token-validator.service.js';
import type { BotService } from './bot.service.js';

describe('BotTokenValidatorService', () => {
  let service: BotTokenValidatorService;
  let botService: {
    validateAccessTokenWithContext: jest.Mock<(...args: any[]) => any>;
  };

  beforeEach(() => {
    botService = {
      validateAccessTokenWithContext: jest.fn<any>(),
    };
    service = new BotTokenValidatorService(botService as unknown as BotService);
  });

  it('returns a JwtPayload carrying tenantId, email, and username for a valid token', async () => {
    botService.validateAccessTokenWithContext.mockResolvedValue({
      botId: 'bot-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'bot-1@example.com',
      username: 'bot-1',
    });

    const payload = await service.validateBotToken('t9bot_raw');

    expect(payload).toEqual({
      sub: 'user-1',
      email: 'bot-1@example.com',
      username: 'bot-1',
      tenantId: 'tenant-1',
    });
    expect(botService.validateAccessTokenWithContext).toHaveBeenCalledWith(
      't9bot_raw',
    );
  });

  it('returns null when the bot service cannot validate the token', async () => {
    botService.validateAccessTokenWithContext.mockResolvedValue(null);

    await expect(service.validateBotToken('t9bot_bad')).resolves.toBeNull();
  });

  it('uses the context variant so tenantId is always carried through', async () => {
    // Regression guard: we must not fall back to validateAccessToken, which
    // does not return tenantId — the bot-scoped request path relies on the
    // tenantId from the payload to populate request.tenantId in AuthGuard.
    botService.validateAccessTokenWithContext.mockResolvedValue({
      botId: 'bot-2',
      userId: 'user-2',
      tenantId: 'tenant-2',
      email: 'bot-2@example.com',
      username: 'bot-2',
    });

    const payload = await service.validateBotToken('t9bot_any');

    expect(payload?.tenantId).toBe('tenant-2');
  });
});
