import { afterEach, describe, expect, it } from '@jest/globals';
import { ConfigService } from './config.service.js';

describe('ConfigService MiniMax provider', () => {
  afterEach(() => {
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_BASE;
  });

  it('reads the API key and defaults to the global API base URL', () => {
    process.env.MINIMAX_API_KEY = 'test-minimax-key';
    const service = new ConfigService({} as never);

    expect(service.getAIProviderConfig('minimax')).toEqual({
      apiKey: 'test-minimax-key',
      baseURL: 'https://api.minimax.io/v1',
    });
    expect(service.isAIProviderConfigured('minimax')).toBe(true);
  });

  it('honors a custom API base URL from the environment', () => {
    process.env.MINIMAX_API_KEY = 'test-minimax-key';
    process.env.MINIMAX_API_BASE = 'https://api.minimaxi.com/v1';
    const service = new ConfigService({} as never);

    expect(service.getAIProviderConfig('minimax')).toEqual({
      apiKey: 'test-minimax-key',
      baseURL: 'https://api.minimaxi.com/v1',
    });
  });
});
