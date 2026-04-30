import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { CapabilityHubClient } from './capability-hub.client.js';

describe('CapabilityHubClient', () => {
  let client: CapabilityHubClient;

  let fetchMock: ReturnType<typeof jest.spyOn<any, any>>;

  beforeEach(() => {
    const config = {
      getOrThrow: (k: string) => {
        if (k === 'CAPABILITY_HUB_URL') return 'http://hub.test';
        throw new Error('missing');
      },
      get: (k: string) => {
        if (k === 'CAPABILITY_HUB_API_KEY') return 'test-service-key';
        return undefined;
      },
    } as unknown as ConfigService;
    client = new CapabilityHubClient(config);
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('forwards auth + tenant headers and path', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await client.request('POST', '/api/proxy/openrouter/chat/completions', {
      headers: {
        authorization: 'Bearer T',
        'x-tenant-id': 'tnt',
      },
      body: JSON.stringify({ input: 'hi' }),
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hub.test/api/proxy/openrouter/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer T',
      'x-tenant-id': 'tnt',
    });
    expect((init as RequestInit).body).toBe('{"input":"hi"}');
  });

  it('passes AbortSignal through', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const ac = new AbortController();
    await client.request('GET', '/x', { signal: ac.signal });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(ac.signal);
  });

  it('serviceHeaders emits shared key + identity headers', () => {
    const headers = client.serviceHeaders({
      userId: 'u1',
      tenantId: 't1',
    });
    expect(headers).toEqual({
      'x-service-key': 'test-service-key',
      'x-user-id': 'u1',
      'x-tenant-id': 't1',
    });
  });

  it('serviceHeaders throws when API key is not configured', () => {
    const config = {
      getOrThrow: () => 'http://hub.test',
      get: () => undefined,
    } as unknown as ConfigService;
    const c = new CapabilityHubClient(config);
    expect(() => c.serviceHeaders({ userId: 'u', tenantId: 't' })).toThrow(
      /CAPABILITY_HUB_API_KEY/,
    );
  });
});
