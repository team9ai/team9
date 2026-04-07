import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ExecutionContext } from '../execution-strategy.interface.js';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockDb = {
  select: jest.fn<any>(),
  from: jest.fn<any>(),
  leftJoin: jest.fn<any>(),
  where: jest.fn<any>(),
  limit: jest.fn<any>(),
};

// Chain: db.select().from().leftJoin().where().limit()
mockDb.select.mockReturnValue(mockDb);
mockDb.from.mockReturnValue(mockDb);
mockDb.leftJoin.mockReturnValue(mockDb);
mockDb.where.mockReturnValue(mockDb);
mockDb.limit.mockReturnValue(Promise.resolve([]));

const mockFetch = jest.fn<typeof globalThis.fetch>();

const baseContext: ExecutionContext = {
  routineId: 'task-001',
  executionId: 'exec-001',
  botId: 'bot-001',
  channelId: 'ch-001',
  title: 'Test task',
  taskcastTaskId: 'agent_task_exec_exec-001',
  tenantId: 'tenant-001',
};

// ── Helpers ────────────────────────────────────────────────────────────

function resetDbChain(result: any[] = []) {
  mockDb.select.mockReturnValue(mockDb);
  mockDb.from.mockReturnValue(mockDb);
  mockDb.leftJoin.mockReturnValue(mockDb);
  mockDb.where.mockReturnValue(mockDb);
  mockDb.limit.mockReturnValue(Promise.resolve(result));
}

function makeBot(opts: {
  agentId?: string;
  accessUrl?: string;
  nestedAccessUrl?: string;
  gatewayToken?: string;
}) {
  const extra = opts.agentId ? { openclaw: { agentId: opts.agentId } } : {};
  const secrets: Record<string, any> = {};
  if (opts.accessUrl) {
    secrets.instanceResult = {
      access_url: opts.accessUrl,
      gateway_token: opts.gatewayToken ?? 'test-gw-token',
    };
  } else if (opts.nestedAccessUrl) {
    secrets.instanceResult = {
      instance: { access_url: opts.nestedAccessUrl },
      gateway_token: opts.gatewayToken ?? 'test-gw-token',
    };
  }
  return { extra, secrets };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('OpenclawStrategy', () => {
  let OpenclawStrategy: any;
  let strategy: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    // Reset fetch mock
    globalThis.fetch = mockFetch as any;
    mockFetch.mockReset();

    // Dynamic import to pick up mocks
    ({ OpenclawStrategy } = await import('./openclaw.strategy.js'));
    strategy = new OpenclawStrategy(mockDb);
  });

  // ── Bot not found ──────────────────────────────────────────────────

  it('should throw when bot is not found in database', async () => {
    resetDbChain([]);

    await expect(strategy.execute(baseContext)).rejects.toThrow(
      'OpenClaw bot not found: bot-001',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── URL extraction ─────────────────────────────────────────────────

  it('should throw when secrets have no access_url at any level', async () => {
    resetDbChain([{ extra: {}, secrets: {} }]);

    await expect(strategy.execute(baseContext)).rejects.toThrow(
      'OpenClaw URL not configured for bot bot-001',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should throw when secrets is null (leftJoin returned no installed app)', async () => {
    resetDbChain([{ extra: {}, secrets: null }]);

    await expect(strategy.execute(baseContext)).rejects.toThrow(
      'OpenClaw URL not configured for bot bot-001',
    );
  });

  it('should use top-level access_url from secrets', async () => {
    const bot = makeBot({ accessUrl: 'https://claw.example.com' });
    resetDbChain([bot]);
    mockFetch.mockResolvedValue({ ok: true } as Response);

    await strategy.execute(baseContext);

    const calledUrl = (mockFetch.mock.calls[0][0] as URL).toString();
    expect(calledUrl).toBe(
      'https://claw.example.com/api/agents/default/execute',
    );
  });

  it('should fall back to nested instance.access_url when top-level is missing', async () => {
    const bot = makeBot({ nestedAccessUrl: 'https://nested.example.com' });
    resetDbChain([bot]);
    mockFetch.mockResolvedValue({ ok: true } as Response);

    await strategy.execute(baseContext);

    const calledUrl = (mockFetch.mock.calls[0][0] as URL).toString();
    expect(calledUrl).toBe(
      'https://nested.example.com/api/agents/default/execute',
    );
  });

  // ── Agent ID extraction ────────────────────────────────────────────

  it('should default agentId to "default" when extra.openclaw is missing', async () => {
    resetDbChain([
      {
        extra: {},
        secrets: {
          instanceResult: {
            access_url: 'https://x.com',
            gateway_token: 'test-gw-token',
          },
        },
      },
    ]);
    mockFetch.mockResolvedValue({ ok: true } as Response);

    await strategy.execute(baseContext);

    const calledUrl = (mockFetch.mock.calls[0][0] as URL).toString();
    expect(calledUrl).toContain('/api/agents/default/execute');
  });

  it('should use custom agentId from extra.openclaw.agentId', async () => {
    const bot = makeBot({
      agentId: 'my-agent',
      accessUrl: 'https://claw.example.com',
    });
    resetDbChain([bot]);
    mockFetch.mockResolvedValue({ ok: true } as Response);

    await strategy.execute(baseContext);

    const calledUrl = (mockFetch.mock.calls[0][0] as URL).toString();
    expect(calledUrl).toBe(
      'https://claw.example.com/api/agents/my-agent/execute',
    );
  });

  it('should URL-encode agentId with special characters', async () => {
    const bot = makeBot({
      agentId: 'agent/with spaces',
      accessUrl: 'https://claw.example.com',
    });
    resetDbChain([bot]);
    mockFetch.mockResolvedValue({ ok: true } as Response);

    await strategy.execute(baseContext);

    const calledUrl = (mockFetch.mock.calls[0][0] as URL).toString();
    expect(calledUrl).toContain('/api/agents/agent%2Fwith%20spaces/execute');
  });

  // ── HTTP response handling ─────────────────────────────────────────

  it('should not throw when fetch returns ok', async () => {
    const bot = makeBot({ accessUrl: 'https://claw.example.com' });
    resetDbChain([bot]);
    mockFetch.mockResolvedValue({ ok: true } as Response);

    await expect(strategy.execute(baseContext)).resolves.toBeUndefined();
  });

  it('should throw with status and error text when fetch returns non-ok', async () => {
    const bot = makeBot({ accessUrl: 'https://claw.example.com' });
    resetDbChain([bot]);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: () => Promise.resolve('upstream timeout'),
    } as unknown as Response);

    await expect(strategy.execute(baseContext)).rejects.toThrow(
      'OpenClaw execute failed (502): upstream timeout',
    );
  });

  it('should use statusText as fallback when error body is empty', async () => {
    const bot = makeBot({ accessUrl: 'https://claw.example.com' });
    resetDbChain([bot]);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve(''),
    } as unknown as Response);

    await expect(strategy.execute(baseContext)).rejects.toThrow(
      'OpenClaw execute failed (500): Internal Server Error',
    );
  });

  it('should send POST with body, auth headers, and abort signal', async () => {
    const bot = makeBot({ accessUrl: 'https://claw.example.com' });
    resetDbChain([bot]);
    mockFetch.mockResolvedValue({ ok: true } as Response);

    await strategy.execute(baseContext);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-gw-token',
        }),
        body: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    );

    // Verify body content
    const callOpts = mockFetch.mock.calls[0][1] as RequestInit;
    const parsedBody = JSON.parse(callOpts.body as string);
    expect(parsedBody).toEqual(
      expect.objectContaining({
        channelId: 'ch-001',
        task: { taskId: 'task-001', executionId: 'exec-001' },
      }),
    );
  });

  // ── stop() ─────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('should POST to /api/agents/{agentId}/stop with sessionKey', async () => {
      resetDbChain([
        makeBot({ accessUrl: 'https://oc.test', agentId: 'mybot' }),
      ]);
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      await strategy.stop(baseContext);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: 'https://oc.test/api/agents/mybot/stop',
        }),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"sessionKey"'),
        }),
      );
    });

    it('should not throw if stop returns 404 (run already finished)', async () => {
      resetDbChain([makeBot({ accessUrl: 'https://oc.test' })]);
      mockFetch.mockResolvedValueOnce(
        new Response('Not found', { status: 404 }),
      );

      await expect(strategy.stop(baseContext)).resolves.not.toThrow();
    });
  });
});
