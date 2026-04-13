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
    } as unknown as ConfigService;
    client = new CapabilityHubClient(config);
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('forwards auth + tenant headers and path', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await client.request('POST', '/api/deep-research/tasks', {
      headers: {
        authorization: 'Bearer T',
        'x-tenant-id': 'tnt',
      },
      body: JSON.stringify({ input: 'hi' }),
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hub.test/api/deep-research/tasks');
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
});
