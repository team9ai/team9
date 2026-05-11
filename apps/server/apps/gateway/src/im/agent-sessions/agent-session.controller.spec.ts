import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AgentSessionController } from './agent-session.controller.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('AgentSessionController', () => {
  let bindingService: { resolve: MockFn };
  let clawHive: { getSessionStatus: MockFn; getSessionComponents: MockFn };
  let jwtService: { verify: MockFn };
  let controller: AgentSessionController;

  beforeEach(() => {
    bindingService = {
      resolve: jest.fn<any>(),
    };
    clawHive = {
      getSessionStatus: jest.fn<any>(),
      getSessionComponents: jest.fn<any>(),
    };
    jwtService = {
      verify: jest.fn<any>(),
    };
    controller = new AgentSessionController(
      bindingService as any,
      clawHive as any,
      jwtService as any,
    );
  });

  it('returns binding plus active status when Hive reports ownership or queue activity', async () => {
    bindingService.resolve.mockResolvedValue({
      channelId: 'channel-1',
      channelType: 'direct',
      kind: 'dm',
      tenantId: 'tenant-1',
      supported: true,
      agentId: 'agent-1',
      botUserId: 'bot-user-1',
      sessionId: 'session-1',
    });
    clawHive.getSessionStatus.mockResolvedValue({
      sessionId: 'session-1',
      isStreaming: false,
      ownedBy: 'worker-1',
      queueLength: 0,
    });

    await expect(
      controller.getBinding('user-1', 'channel-1'),
    ).resolves.toMatchObject({
      channelId: 'channel-1',
      supported: true,
      sessionId: 'session-1',
      status: {
        exists: true,
        status: 'active',
        ownedBy: 'worker-1',
        queueLength: 0,
        activityState: 'active',
      },
    });
    expect(clawHive.getSessionStatus).toHaveBeenCalledWith(
      'session-1',
      'tenant-1',
    );
  });

  it('maps missing Hive status to not_found without failing binding lookup', async () => {
    bindingService.resolve.mockResolvedValue({
      channelId: 'channel-1',
      channelType: 'direct',
      kind: 'dm',
      tenantId: null,
      supported: true,
      agentId: 'agent-1',
      botUserId: 'bot-user-1',
      sessionId: 'session-1',
    });
    clawHive.getSessionStatus.mockResolvedValue(null);

    await expect(controller.getBinding('user-1', 'channel-1')).resolves.toEqual(
      expect.objectContaining({
        status: { exists: false, unavailableReason: 'not_found' },
      }),
    );
  });

  it('returns sanitized projected components and strips configs', async () => {
    bindingService.resolve.mockResolvedValue({
      channelId: 'channel-1',
      channelType: 'direct',
      kind: 'dm',
      tenantId: 'tenant-1',
      supported: true,
      agentId: 'agent-1',
      botUserId: 'bot-user-1',
      sessionId: 'session-1',
    });
    clawHive.getSessionComponents.mockResolvedValue({
      sessionId: 'session-1',
      components: [
        {
          id: 'workspace',
          typeKey: 'just-bash-team9-workspace',
          priority: 10,
          declaredConfig: { token: 'secret' },
          effectiveConfig: { apiKey: 'secret' },
          schema: [{ name: 'folder' }],
          runtimeInjectedOnly: false,
          latestData: {
            data: { folder: '/tmp/project', authorization: 'Bearer secret' },
            capturedAtCallId: 'call-1',
            capturedAt: 123,
          },
        },
      ],
    });

    await expect(
      controller.getComponents('user-1', 'channel-1'),
    ).resolves.toEqual({
      sessionId: 'session-1',
      components: [
        {
          id: 'workspace',
          typeKey: 'just-bash-team9-workspace',
          priority: 10,
          schema: [{ name: 'folder' }],
          runtimeInjectedOnly: false,
          latestData: {
            data: { folder: '/tmp/project', authorization: '[redacted]' },
            capturedAtCallId: 'call-1',
            capturedAt: 123,
          },
        },
      ],
    });
    expect(clawHive.getSessionComponents).toHaveBeenCalledWith(
      'session-1',
      'tenant-1',
    );
  });

  it('throws NotFoundException for unsupported component bindings', async () => {
    bindingService.resolve.mockResolvedValue({
      channelId: 'channel-1',
      channelType: 'public',
      kind: null,
      tenantId: null,
      supported: false,
      unsupportedReason: 'no_bot',
      agentId: null,
      botUserId: null,
      sessionId: null,
    });

    await expect(
      controller.getComponents('user-1', 'channel-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(clawHive.getSessionComponents).not.toHaveBeenCalled();
  });

  it('filters SSE records through the agent session allowlist and redaction', () => {
    expect(
      (controller as any).filterSseRecord(
        'event: message\ndata: {"type":"tool_execution_start","args":{"token":"raw"}}',
      ),
    ).toBeNull();

    expect(
      (controller as any).filterSseRecord(
        'id: 7\ndata: {"type":"component_data_snapshot","components":[{"componentId":"host","data":{"credential":"raw","visible":true}}]}',
      ),
    ).toBe(
      'id: 7\ndata: {"type":"component_data_snapshot","components":[{"componentId":"host","data":{"credential":"[redacted]","visible":true}}]}',
    );
  });

  it('drops non-json SSE data records except ping heartbeats', () => {
    expect((controller as any).filterSseRecord('data: internal-event')).toBe(
      null,
    );

    expect((controller as any).filterSseRecord('data: ping')).toBe(
      'data: ping',
    );
  });

  it('does not let comment-prefixed SSE records bypass data filtering', () => {
    expect(
      (controller as any).filterSseRecord(
        ': keepalive\ndata: {"type":"tool_execution_start","args":{"token":"raw"}}',
      ),
    ).toBeNull();

    expect((controller as any).filterSseRecord(': keepalive')).toBe(
      ': keepalive',
    );
  });
});
