import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

// Mock @team9/shared env before importing the service
jest.unstable_mockModule('@team9/shared', () => ({
  env: {
    CLAW_HIVE_API_URL: 'http://test-hive:9999',
    CLAW_HIVE_AUTH_TOKEN: 'test-token',
  },
}));

// Dynamic import after mock
const { ClawHiveService } = await import('./claw-hive.service.js');

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFetchFn = jest.Mock<typeof globalThis.fetch>;
let mockFetch: MockFetchFn;
let originalFetch: typeof globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('ClawHiveService', () => {
  let service: InstanceType<typeof ClawHiveService>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = jest.fn<typeof globalThis.fetch>();
    globalThis.fetch = mockFetch;
    service = new ClawHiveService();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── healthCheck ──────────────────────────────────────────────────────────

  describe('healthCheck', () => {
    it('returns true when API responds with 200', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const result = await service.healthCheck();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-hive:9999/api/health',
      );
    });

    it('returns false when API responds with non-200', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Service Unavailable', 503));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });

    it('returns false when fetch throws (network error)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });
  });

  // ── registerAgent ────────────────────────────────────────────────────────

  describe('registerAgent', () => {
    const params = {
      id: 'agent-1',
      name: 'Test Agent',
      blueprintId: 'test-blueprint',
      tenantId: 'tenant-123',
      model: { provider: 'openrouter', id: 'anthropic/claude-sonnet-4' },
      componentConfigs: { 'system-prompt': { prompt: 'Hello' } },
    };

    it('sends POST to /api/agents with correct headers and body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'agent-1' }, 201));

      await service.registerAgent(params);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-hive:9999/api/agents',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(params),
        }),
      );

      // Check headers
      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Hive-Auth']).toBe('test-token');
      expect(headers['X-Hive-Tenant']).toBe('tenant-123');
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Conflict', 409));

      await expect(service.registerAgent(params)).rejects.toThrow(
        'Failed to register agent: 409 Conflict',
      );
    });
  });

  // ── deleteAgent ──────────────────────────────────────────────────────────

  describe('deleteAgent', () => {
    it('sends DELETE to /api/agents/:id with URL encoding', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

      await service.deleteAgent('base-model-claude-abcd1234');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-hive:9999/api/agents/base-model-claude-abcd1234',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('URL-encodes agent IDs with special characters', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

      await service.deleteAgent('agent/with/slashes');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-hive:9999/api/agents/agent%2Fwith%2Fslashes',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Not Found', 404));

      await expect(service.deleteAgent('missing-agent')).rejects.toThrow(
        'Failed to delete agent: 404',
      );
    });
  });

  // ── sendInput ────────────────────────────────────────────────────────────

  describe('sendInput', () => {
    const event = {
      type: 'team9:message.text',
      source: 'team9',
      timestamp: '2026-03-20T00:00:00.000Z',
      payload: { messageId: 'msg-1', content: 'Hello' },
    };
    const sessionId = 'team9/tenant/agent/dm/channel';

    it('sends POST to /api/sessions/:id/input with URL-encoded session ID', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ messages: [] }));

      await service.sendInput(sessionId, event, 'tenant-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-hive:9999/api/sessions/${encodeURIComponent(sessionId)}/input`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ event }),
        }),
      );
    });

    it('includes X-Hive-Tenant header when tenantId is provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ messages: [] }));

      await service.sendInput(sessionId, event, 'tenant-abc');

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Hive-Tenant']).toBe('tenant-abc');
    });

    it('omits X-Hive-Tenant header when tenantId is undefined', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ messages: [] }));

      await service.sendInput(sessionId, event);

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Hive-Tenant']).toBeUndefined();
    });

    it('returns parsed JSON response', async () => {
      const responseBody = { messages: [{ role: 'assistant', content: 'Hi' }] };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await service.sendInput(sessionId, event);

      expect(result).toEqual(responseBody);
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Bad Request', 400));

      await expect(service.sendInput(sessionId, event)).rejects.toThrow(
        'Failed to send input: 400 Bad Request',
      );
    });

    it('passes AbortSignal to fetch', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ messages: [] }));

      await service.sendInput(sessionId, event);

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ── headers ──────────────────────────────────────────────────────────────

  describe('headers', () => {
    it('always includes Content-Type and X-Hive-Auth', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ messages: [] }));

      await service.sendInput('sess-1', {
        type: 'test',
        source: 'test',
        timestamp: '',
        payload: {},
      });

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Hive-Auth']).toBe('test-token');
    });
  });
});
