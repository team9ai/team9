import { afterEach, describe, expect, it } from '@jest/globals';
import { ConfigService } from './config.service.js';

describe('ConfigService Atlas Cloud provider', () => {
  afterEach(() => {
    delete process.env.ATLASCLOUD_API_KEY;
    delete process.env.ATLAS_CLOUD_API_KEY;
    delete process.env.ATLASCLOUD_API_BASE;
    delete process.env.ATLAS_CLOUD_API_BASE;
  });

  it('supports ATLAS_CLOUD aliases and the default API base URL', () => {
    process.env.ATLASCLOUD_API_KEY = '';
    process.env.ATLAS_CLOUD_API_KEY = 'test-atlas-key';
    const service = new ConfigService({} as never);

    expect(service.getAIProviderConfig('atlascloud')).toEqual({
      apiKey: 'test-atlas-key',
      baseURL: 'https://api.atlascloud.ai/v1',
    });
    expect(service.isAIProviderConfigured('atlascloud')).toBe(true);
  });
});
