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
  let service: AgentSessionBindingService;

  beforeEach(() => {
    dbMock = createDbMock();
    service = new AgentSessionBindingService(dbMock.db as any);
  });

  it('throws 404 when the channel does not exist', async () => {
    dbMock.push([]);

    await expect(service.resolve('channel-1', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws 403 when the user is not a channel member', async () => {
    dbMock.push([{ id: 'channel-1', tenantId: 'tenant-1', type: 'direct' }]);
    dbMock.push([]);

    await expect(service.resolve('channel-1', 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('derives a direct bot DM session id', async () => {
    dbMock.push([{ id: 'channel-1', tenantId: 'tenant-1', type: 'direct' }]);
    dbMock.push([{ id: 'member-1' }]);
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
    dbMock.push([{ id: 'member-1' }]);
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

  it('resolves a Hive routine execution task channel', async () => {
    dbMock.push([{ id: 'task-channel', tenantId: 'tenant-1', type: 'task' }]);
    dbMock.push([{ id: 'member-1' }]);
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
    });
  });

  it('returns unsupported for OpenClaw task channel', async () => {
    dbMock.push([{ id: 'task-channel', tenantId: 'tenant-1', type: 'task' }]);
    dbMock.push([{ id: 'member-1' }]);
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
