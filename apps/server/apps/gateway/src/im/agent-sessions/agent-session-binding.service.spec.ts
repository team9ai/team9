import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AgentSessionBindingService } from './agent-session-binding.service.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

function createDbMock() {
  const rows: unknown[][] = [];
  const chain: Record<string, MockFn> = {};
  for (const method of [
    'select',
    'from',
    'where',
    'limit',
    'innerJoin',
    'leftJoin',
  ]) {
    chain[method] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockImplementation(() => Promise.resolve(rows.shift() ?? []));
  return {
    db: chain,
    push: (result: unknown[]) => rows.push(result),
  };
}

describe('AgentSessionBindingService', () => {
  let dbMock: ReturnType<typeof createDbMock>;
  let channelsService: { assertReadAccess: jest.Mock<(...args: any[]) => any> };
  let service: AgentSessionBindingService;

  beforeEach(() => {
    dbMock = createDbMock();
    channelsService = {
      assertReadAccess: jest.fn<any>().mockResolvedValue(undefined),
    };
    service = new AgentSessionBindingService(
      dbMock.db as any,
      channelsService as any,
    );
  });

  it('throws 404 when the channel does not exist', async () => {
    dbMock.push([]);

    await expect(service.resolve('channel-1', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws 403 when the user is not a channel member', async () => {
    dbMock.push([{ id: 'channel-1', tenantId: 'tenant-1', type: 'direct' }]);
    channelsService.assertReadAccess.mockRejectedValueOnce(
      new ForbiddenException('Access denied'),
    );

    await expect(service.resolve('channel-1', 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(channelsService.assertReadAccess).toHaveBeenCalledWith(
      'channel-1',
      'user-1',
    );
  });

  it('derives a direct bot DM session id', async () => {
    dbMock.push([{ id: 'channel-1', tenantId: 'tenant-1', type: 'direct' }]);
    dbMock.push([
      {
        botUserId: 'bot-user-1',
        managedProvider: 'hive',
        managedMeta: { agentId: 'agent-1' },
      },
    ]);

    await expect(service.resolve('channel-1', 'user-1')).resolves.toMatchObject(
      {
        channelId: 'channel-1',
        kind: 'dm',
        supported: true,
        agentId: 'agent-1',
        botUserId: 'bot-user-1',
        sessionId: 'team9/tenant-1/agent-1/dm/channel-1',
      },
    );
  });

  it('derives a tracking channel session id after read access is granted', async () => {
    dbMock.push([{ id: 'track-1', tenantId: 'tenant-1', type: 'tracking' }]);
    dbMock.push([
      {
        botUserId: 'bot-user-1',
        managedProvider: 'hive',
        managedMeta: { agentId: 'agent-1' },
      },
    ]);

    await expect(service.resolve('track-1', 'user-1')).resolves.toMatchObject({
      channelId: 'track-1',
      kind: 'tracking',
      supported: true,
      agentId: 'agent-1',
      botUserId: 'bot-user-1',
      sessionId: 'team9/tenant-1/agent-1/tracking/track-1',
    });
  });

  it('prefers topic-session propertySettings session id', async () => {
    dbMock.push([
      {
        id: 'topic-1',
        tenantId: 'tenant-1',
        type: 'topic-session',
        propertySettings: {
          topicSession: {
            agentId: 'agent-from-settings',
            sessionId: 'team9/tenant-1/agent-from-settings/dm/topic-1',
          },
        },
      },
    ]);
    dbMock.push([
      {
        botUserId: 'bot-user-1',
        managedProvider: 'hive',
        managedMeta: { agentId: 'agent-from-bot' },
      },
    ]);

    await expect(service.resolve('topic-1', 'user-1')).resolves.toMatchObject({
      kind: 'topic-session',
      agentId: 'agent-from-settings',
      sessionId: 'team9/tenant-1/agent-from-settings/dm/topic-1',
    });
  });

  it('does not support a topic-session setting without an active Hive bot row', async () => {
    dbMock.push([
      {
        id: 'topic-1',
        tenantId: 'tenant-1',
        type: 'topic-session',
        propertySettings: {
          topicSession: {
            agentId: 'agent-from-settings',
            sessionId: 'team9/tenant-1/agent-from-settings/dm/topic-1',
          },
        },
      },
    ]);
    dbMock.push([]);

    await expect(service.resolve('topic-1', 'user-1')).resolves.toMatchObject({
      kind: 'topic-session',
      supported: false,
      unsupportedReason: 'no_bot',
      sessionId: null,
    });
  });

  it('does not let topic-session settings override a non-Hive bot row', async () => {
    dbMock.push([
      {
        id: 'topic-1',
        tenantId: 'tenant-1',
        type: 'topic-session',
        propertySettings: {
          topicSession: {
            agentId: 'agent-from-settings',
            sessionId: 'team9/tenant-1/agent-from-settings/dm/topic-1',
          },
        },
      },
    ]);
    dbMock.push([
      {
        botUserId: 'bot-user-1',
        managedProvider: 'openclaw',
        managedMeta: { instanceId: 'instance-1' },
      },
    ]);

    await expect(service.resolve('topic-1', 'user-1')).resolves.toMatchObject({
      kind: 'topic-session',
      supported: false,
      unsupportedReason: 'not_hive_managed',
      sessionId: null,
    });
  });

  it('resolves a routine creation session channel', async () => {
    dbMock.push([
      { id: 'routine-channel', tenantId: 'tenant-1', type: 'routine-session' },
    ]);
    dbMock.push([
      {
        routineId: 'routine-1',
        creationSessionId: 'team9/tenant-1/agent-1/dm/routine-channel',
        botUserId: 'bot-user-1',
        managedProvider: 'hive',
        managedMeta: { agentId: 'agent-1' },
      },
    ]);

    await expect(
      service.resolve('routine-channel', 'user-1'),
    ).resolves.toMatchObject({
      kind: 'routine-creation',
      supported: true,
      routineId: 'routine-1',
      agentId: 'agent-1',
      botUserId: 'bot-user-1',
      sessionId: 'team9/tenant-1/agent-1/dm/routine-channel',
    });
  });

  it('returns unsupported when a routine creation channel has no routine row', async () => {
    dbMock.push([
      { id: 'routine-channel', tenantId: 'tenant-1', type: 'routine-session' },
    ]);
    dbMock.push([]);

    await expect(
      service.resolve('routine-channel', 'user-1'),
    ).resolves.toMatchObject({
      kind: 'routine-creation',
      supported: false,
      unsupportedReason: 'no_bot',
      sessionId: null,
    });
  });

  it('returns unsupported when a routine creation channel is not Hive-managed', async () => {
    dbMock.push([
      { id: 'routine-channel', tenantId: 'tenant-1', type: 'routine-session' },
    ]);
    dbMock.push([
      {
        routineId: 'routine-1',
        creationSessionId: 'team9/tenant-1/agent-1/dm/routine-channel',
        botUserId: 'bot-user-1',
        managedProvider: 'openclaw',
        managedMeta: { instanceId: 'instance-1' },
      },
    ]);

    await expect(
      service.resolve('routine-channel', 'user-1'),
    ).resolves.toMatchObject({
      kind: 'routine-creation',
      supported: false,
      unsupportedReason: 'not_hive_managed',
      sessionId: null,
    });
  });

  it('returns unsupported when a routine creation session is missing', async () => {
    dbMock.push([
      { id: 'routine-channel', tenantId: 'tenant-1', type: 'routine-session' },
    ]);
    dbMock.push([
      {
        routineId: 'routine-1',
        creationSessionId: null,
        botUserId: 'bot-user-1',
        managedProvider: 'hive',
        managedMeta: { agentId: 'agent-1' },
      },
    ]);

    await expect(
      service.resolve('routine-channel', 'user-1'),
    ).resolves.toMatchObject({
      kind: 'routine-creation',
      supported: false,
      unsupportedReason: 'session_not_created',
      sessionId: null,
    });
  });

  it('resolves a Hive routine execution task channel', async () => {
    dbMock.push([{ id: 'task-channel', tenantId: 'tenant-1', type: 'task' }]);
    dbMock.push([
      {
        executionId: 'exec-1',
        routineId: 'routine-1',
        taskcastTaskId: 'agent_task_exec_exec-1',
        taskStatus: 'in_progress',
        botUserId: 'bot-user-1',
        managedProvider: 'hive',
        managedMeta: { agentId: 'agent-1' },
      },
    ]);

    await expect(
      service.resolve('task-channel', 'user-1'),
    ).resolves.toMatchObject({
      kind: 'routine-execution',
      supported: true,
      sessionId: 'team9/tenant-1/agent-1/routine/exec-1',
      routineId: 'routine-1',
      executionId: 'exec-1',
      taskcastTaskId: 'agent_task_exec_exec-1',
      taskStatus: 'in_progress',
    });
  });

  it('returns unsupported for OpenClaw task channel', async () => {
    dbMock.push([{ id: 'task-channel', tenantId: 'tenant-1', type: 'task' }]);
    dbMock.push([
      {
        executionId: 'exec-1',
        routineId: 'routine-1',
        taskStatus: 'in_progress',
        botUserId: 'bot-user-1',
        managedProvider: 'openclaw',
        managedMeta: { instanceId: 'instance-1' },
      },
    ]);

    await expect(
      service.resolve('task-channel', 'user-1'),
    ).resolves.toMatchObject({
      supported: false,
      unsupportedReason: 'not_hive_managed',
      sessionId: null,
    });
  });
});
