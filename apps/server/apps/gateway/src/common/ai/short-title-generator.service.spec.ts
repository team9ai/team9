import { describe, it, expect, jest } from '@jest/globals';

const { ShortTitleGeneratorService } =
  await import('./short-title-generator.service.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('ShortTitleGeneratorService', () => {
  it('routes title generation through capability-hub and cleans the model output', async () => {
    const hub = {
      request: jest.fn<any>().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '「AI总结标题。」' } }],
        }),
      }),
      serviceHeaders: jest.fn<any>().mockReturnValue({
        'x-service-key': 'test-key',
      }),
    };
    const service = new ShortTitleGeneratorService(hub as any);

    await expect(
      service.generate('请根据下面这个要求给我找 youtube 达人', {
        userId: 'user-1',
        tenantId: 'tenant-1',
      }),
    ).resolves.toBe('AI总结标题');

    expect(hub.serviceHeaders).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect((hub.request as MockFn).mock.calls[0]?.[0]).toBe('POST');
    expect((hub.request as MockFn).mock.calls[0]?.[1]).toBe(
      '/api/proxy/openrouter/chat/completions',
    );

    const options = (hub.request as MockFn).mock.calls[0]?.[2] as {
      body: string;
      headers: Record<string, string>;
    };
    const body = JSON.parse(options.body) as {
      model: string;
      max_tokens: number;
      temperature: number;
      messages: Array<{ role: string; content: string }>;
    };

    expect(options.headers['content-type']).toBe('application/json');
    expect(body).toMatchObject({
      model: 'openai/gpt-4o-mini',
      max_tokens: 40,
      temperature: 0.3,
    });
    expect(body.messages[0]?.content).toContain(
      'Max 12 characters for CJK scripts',
    );
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: '请根据下面这个要求给我找 youtube 达人',
    });
  });
});
