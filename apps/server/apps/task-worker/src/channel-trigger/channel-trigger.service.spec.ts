import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { ChannelTriggerService } from './channel-trigger.service.js';

function createSelectChain(result: unknown[] = []) {
  return {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(result),
  };
}

function createUpdateChain() {
  return {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ChannelTriggerService', () => {
  let selectChain: ReturnType<typeof createSelectChain>;
  let updateChain: ReturnType<typeof createUpdateChain>;
  let db: {
    select: ReturnType<typeof jest.fn>;
    update: ReturnType<typeof jest.fn>;
  };
  let executor: {
    triggerExecution: ReturnType<typeof jest.fn>;
  };
  let service: ChannelTriggerService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T10:00:00.000Z'));

    selectChain = createSelectChain();
    updateChain = createUpdateChain();

    db = {
      select: jest.fn().mockReturnValue(selectChain),
      update: jest.fn().mockReturnValue(updateChain),
    };

    executor = {
      triggerExecution: jest.fn().mockResolvedValue(undefined),
    };

    service = new ChannelTriggerService(db as never, executor as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads enabled channel triggers on module init', async () => {
    const logSpy = jest.spyOn((service as any).logger, 'log');
    selectChain.where.mockResolvedValueOnce([
      {
        id: 'trigger-1',
        taskId: 'task-1',
        config: { channelId: 'channel-a' },
      },
      {
        id: 'trigger-2',
        taskId: 'task-2',
        config: { channelId: 'channel-a' },
      },
      {
        id: 'trigger-3',
        taskId: 'task-3',
        config: {},
      },
      {
        id: 'trigger-4',
        taskId: 'task-4',
        config: { channelId: 'channel-b' },
      },
    ]);

    await service.onModuleInit();

    expect((service as any).channelTriggerMap.get('channel-a')).toHaveLength(2);
    expect((service as any).channelTriggerMap.get('channel-b')).toHaveLength(1);
    expect((service as any).channelTriggerMap.has('undefined')).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(
      'Loaded 2 channel(s) with message triggers',
    );
  });

  it('returns early when a message channel has no triggers', async () => {
    await service.handleMessage({
      channelId: 'channel-missing',
      messageId: 'message-1',
      content: 'hello',
      senderId: 'user-1',
    });

    expect(executor.triggerExecution).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('triggers executions and updates lastRunAt for matching channels', async () => {
    (service as any).channelTriggerMap.set('channel-a', [
      { id: 'trigger-1', taskId: 'task-1' },
      { id: 'trigger-2', taskId: 'task-2' },
    ]);
    const longContent = 'x'.repeat(700);

    await service.handleMessage({
      channelId: 'channel-a',
      messageId: 'message-1',
      content: longContent,
      messageType: 'text',
      senderId: 'user-1',
      senderUserType: 'human',
      senderAgentType: null,
    });

    expect(executor.triggerExecution).toHaveBeenNthCalledWith(1, 'task-1', {
      triggerId: 'trigger-1',
      triggerType: 'channel_message',
      triggerContext: {
        triggeredAt: '2026-04-02T10:00:00.000Z',
        channelId: 'channel-a',
        messageId: 'message-1',
        messageContent: 'x'.repeat(500),
        messageType: 'text',
        senderId: 'user-1',
        senderUserType: 'human',
        senderAgentType: null,
      },
    });
    expect(executor.triggerExecution).toHaveBeenNthCalledWith(2, 'task-2', {
      triggerId: 'trigger-2',
      triggerType: 'channel_message',
      triggerContext: {
        triggeredAt: '2026-04-02T10:00:00.000Z',
        channelId: 'channel-a',
        messageId: 'message-1',
        messageContent: 'x'.repeat(500),
        messageType: 'text',
        senderId: 'user-1',
        senderUserType: 'human',
        senderAgentType: null,
      },
    });
    expect(updateChain.set).toHaveBeenCalledWith({
      lastRunAt: new Date('2026-04-02T10:00:00.000Z'),
      updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    });
    expect(updateChain.where).toHaveBeenCalledTimes(2);
  });

  it('logs errors and keeps processing remaining triggers', async () => {
    const errorSpy = jest.spyOn((service as any).logger, 'error');
    (service as any).channelTriggerMap.set('channel-a', [
      { id: 'trigger-1', taskId: 'task-1' },
      { id: 'trigger-2', taskId: 'task-2' },
    ]);
    executor.triggerExecution
      .mockRejectedValueOnce(new Error('queue down'))
      .mockResolvedValueOnce(undefined);

    await service.handleMessage({
      channelId: 'channel-a',
      messageId: 'message-1',
      content: 'hello',
      messageType: 'text',
      senderId: 'user-1',
      senderUserType: 'human',
      senderAgentType: null,
    });

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to trigger execution for trigger trigger-1: Error: queue down',
    );
    expect(executor.triggerExecution).toHaveBeenCalledTimes(2);
    expect(updateChain.where).toHaveBeenCalledTimes(1);
  });

  it('skips bot-authored messages before triggering executions', async () => {
    const debugSpy = jest.spyOn((service as any).logger, 'debug');
    (service as any).channelTriggerMap.set('channel-a', [
      { id: 'trigger-1', taskId: 'task-1' },
    ]);

    await service.handleMessage({
      channelId: 'channel-a',
      messageId: 'message-1',
      content: 'hello',
      messageType: 'text',
      senderId: 'bot-user-1',
      senderUserType: 'bot',
      senderAgentType: 'openclaw',
    });

    expect(executor.triggerExecution).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      'Skipping channel-message triggers for non-human-authored message message-1 from bot-user-1',
    );
  });
});
