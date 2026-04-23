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

  // ── updateAgent ──────────────────────────────────────────────────────────

  describe('updateAgent', () => {
    it('sends PUT to /api/agents/:id with tenant-scoped metadata', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'agent-1' }));

      await service.updateAgent('agent-1', {
        tenantId: 'tenant-123',
        metadata: {
          tenantId: 'tenant-123',
          botId: 'bot-123',
          mentorId: 'mentor-123',
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-hive:9999/api/agents/agent-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            metadata: {
              tenantId: 'tenant-123',
              botId: 'bot-123',
              mentorId: 'mentor-123',
            },
          }),
        }),
      );

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Hive-Auth']).toBe('test-token');
      expect(headers['X-Hive-Tenant']).toBe('tenant-123');
    });

    it('throws on non-ok responses', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Bad Request', 400));

      await expect(
        service.updateAgent('agent-1', {
          tenantId: 'tenant-123',
          metadata: {
            tenantId: 'tenant-123',
            botId: 'bot-123',
            mentorId: null,
          },
        }),
      ).rejects.toThrow('Failed to update agent: 400 Bad Request');
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

  // ── createSession ────────────────────────────────────────────────────────

  describe('createSession', () => {
    it('sends POST to /api/agents/:agentId/sessions with URL-encoded agent ID', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ sessionId: 'sess-abc' }, 201),
      );

      await service.createSession(
        'common-staff-bot-1',
        { userId: 'user-1' },
        'tenant-123',
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-hive:9999/api/agents/common-staff-bot-1/sessions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ userId: 'user-1' }),
        }),
      );
    });

    it('URL-encodes agent IDs with special characters', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ sessionId: 'sess-1' }));

      await service.createSession('common-staff/agent/with/slashes', {
        userId: 'u1',
      });

      const calledUrl = (mockFetch.mock.calls[0] as any[])[0] as string;
      expect(calledUrl).toBe(
        'http://test-hive:9999/api/agents/common-staff%2Fagent%2Fwith%2Fslashes/sessions',
      );
    });

    it('includes X-Hive-Tenant header when tenantId provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ sessionId: 's1' }));

      await service.createSession('agent-1', { userId: 'u1' }, 'tenant-abc');

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Hive-Tenant']).toBe('tenant-abc');
    });

    it('omits X-Hive-Tenant header when tenantId is not provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ sessionId: 's1' }));

      await service.createSession('agent-1', { userId: 'u1' });

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Hive-Tenant']).toBeUndefined();
    });

    it('forwards team9Context in the request body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ sessionId: 's1' }));

      const team9Context = {
        source: 'team9',
        scopeType: 'dm',
        scopeId: 'channel-1',
        peerUserId: 'mentor-1',
        isMentorDm: true,
      };

      await service.createSession(
        'agent-1',
        { userId: 'u1', team9Context },
        'tenant-1',
      );

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as Record<string, unknown>;
      expect(body.team9Context).toEqual(team9Context);
    });

    it('returns the sessionId from the response', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ sessionId: 'new-session-id' }),
      );

      const result = await service.createSession('agent-1', { userId: 'u1' });

      expect(result).toEqual({ sessionId: 'new-session-id' });
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Agent not found', 404));

      await expect(
        service.createSession('missing-agent', { userId: 'u1' }),
      ).rejects.toThrow('Failed to create session: 404 Agent not found');
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

  // ── interruptSession ─────────────────────────────────────────────────────

  describe('interruptSession', () => {
    it('sends POST to /api/sessions/{id}/interrupt with auth headers', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'interrupted' }));

      await service.interruptSession('my-session-id', 'tenant-abc');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-hive:9999/api/sessions/my-session-id/interrupt',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Hive-Auth': 'test-token',
            'X-Hive-Tenant': 'tenant-abc',
          }),
        }),
      );
    });

    it('URL-encodes session IDs containing slashes', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await service.interruptSession('team9/t1/agent/task/task-1');

      const calledUrl = (mockFetch.mock.calls[0] as any[])[0] as string;
      expect(calledUrl).toBe(
        'http://test-hive:9999/api/sessions/team9%2Ft1%2Fagent%2Ftask%2Ftask-1/interrupt',
      );
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Session not found', 404));

      await expect(service.interruptSession('bad-session')).rejects.toThrow(
        'Failed to interrupt session: 404',
      );
    });
  });

  // ── deleteSession ─────────────────────────────────────────────────────────

  describe('deleteSession', () => {
    it('sends DELETE to /api/sessions/{id}', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await service.deleteSession('sess-abc', 'tenant-xyz');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-hive:9999/api/sessions/sess-abc',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ 'X-Hive-Tenant': 'tenant-xyz' }),
        }),
      );
    });

    it('does not throw on 404 (session already gone)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 }),
      );

      await expect(
        service.deleteSession('gone-session'),
      ).resolves.toBeUndefined();
    });

    it('throws on non-404 error responses', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Server error', 500));

      await expect(service.deleteSession('sess-abc')).rejects.toThrow(
        'Failed to delete session: 500',
      );
    });

    it('does not include X-Hive-Tenant header when tenantId is omitted', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await service.deleteSession('sess-no-tenant');

      const headers = (mockFetch.mock.calls[0] as any[])[1]?.headers ?? {};
      expect(headers['X-Hive-Tenant']).toBeUndefined();
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
