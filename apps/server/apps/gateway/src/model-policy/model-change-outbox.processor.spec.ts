import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ModuleRef } from '@nestjs/core';
import { appMetrics } from '@team9/observability';
import {
  ModelChangeOutboxProcessor,
  ModelChangeOutboxStore,
  type ModelChangeOutboxWorkItem,
  type ModelChangePublicationWorkItem,
} from './model-change-outbox.processor.js';

const baseItem: ModelChangeOutboxWorkItem = {
  outboxId: '10000000-0000-7000-8000-000000000001',
  attemptId: '10000000-0000-7000-8000-000000000002',
  claimToken: '10000000-0000-7000-8000-000000000003',
  retryCount: 0,
  actorUserId: '10000000-0000-7000-8000-000000000004',
  tenantId: '10000000-0000-7000-8000-000000000005',
  channelId: '10000000-0000-7000-8000-000000000006',
  botId: '10000000-0000-7000-8000-000000000007',
  botUserId: '10000000-0000-7000-8000-000000000009',
  applicationId: 'common-staff',
  sessionId: 'hive/tenant/agent/channel/channel-1',
  requestedProvider: 'openrouter',
  requestedModelId: 'anthropic/claude-sonnet-4.6',
  correlationId: 'correlation-1',
  createdAt: new Date('2026-07-16T00:00:00.000Z'),
};

class MemoryOutboxStore extends ModelChangeOutboxStore {
  item: ModelChangeOutboxWorkItem = baseItem;
  status: 'pending' | 'processing' | 'dispatched' | 'failed' = 'pending';
  dispatchStatus: 'pending' | 'dispatched' | 'failed' = 'pending';
  retryCount = 0;
  published = false;
  publicationClaimed = false;
  claimExpired = false;
  lastErrorCode: string | null = null;

  async claimDue(): Promise<ModelChangeOutboxWorkItem[]> {
    if (
      this.status !== 'pending' &&
      !(this.status === 'processing' && this.claimExpired)
    ) {
      return [];
    }
    this.status = 'processing';
    this.claimExpired = false;
    return [{ ...this.item, retryCount: this.retryCount }];
  }

  async claimAttempt(): Promise<ModelChangeOutboxWorkItem | null> {
    return (await this.claimDue())[0] ?? null;
  }

  async markDispatched(): Promise<boolean> {
    if (this.status !== 'processing') return false;
    this.status = 'dispatched';
    this.dispatchStatus = 'dispatched';
    return true;
  }

  async markRetry(
    _item: ModelChangeOutboxWorkItem,
    safeErrorCode: string,
  ): Promise<boolean> {
    if (this.status !== 'processing') return false;
    this.status = 'pending';
    this.retryCount += 1;
    this.lastErrorCode = safeErrorCode;
    return true;
  }

  async markFailed(
    _item: ModelChangeOutboxWorkItem,
    safeErrorCode: string,
  ): Promise<boolean> {
    if (this.status !== 'processing') return false;
    this.status = 'failed';
    this.dispatchStatus = 'failed';
    this.lastErrorCode = safeErrorCode;
    return true;
  }

  async claimPublications(): Promise<ModelChangePublicationWorkItem[]> {
    if (
      this.status !== 'dispatched' ||
      this.published ||
      this.publicationClaimed ||
      !this.item.channelId
    ) {
      return [];
    }
    this.publicationClaimed = true;
    return [
      {
        ...this.item,
        publicationClaimToken: '10000000-0000-7000-8000-000000000008',
        publicationRetryCount: 0,
      },
    ];
  }

  async markPublished(): Promise<boolean> {
    if (!this.publicationClaimed) return false;
    this.publicationClaimed = false;
    this.published = true;
    return true;
  }

  async releasePublication(): Promise<boolean> {
    if (!this.publicationClaimed) return false;
    this.publicationClaimed = false;
    return true;
  }
}

function setup(store = new MemoryOutboxStore()) {
  const hive = {
    changeSessionModel: jest.fn<any>().mockResolvedValue({
      messageId: baseItem.attemptId,
    }),
    getAgent: jest.fn<any>().mockResolvedValue({
      id: 'agent-1',
      tenantId: baseItem.tenantId,
      metadata: { tenantId: baseItem.tenantId },
    }),
    updateAgent: jest.fn<any>().mockResolvedValue(undefined),
  };
  const websocket = {
    sendToChannelMembers: jest.fn<any>().mockResolvedValue(true),
  };
  const bots = {
    getBotById: jest.fn<any>().mockResolvedValue({
      botId: baseItem.botId,
      userId: baseItem.botUserId,
      tenantId: baseItem.tenantId,
      mentorId: baseItem.actorUserId,
      managedMeta: { agentId: 'agent-1' },
      extra: { commonStaff: { model: { provider: 'old', id: 'old' } } },
    }),
    updateBotExtra: jest.fn<any>().mockResolvedValue(undefined),
  };
  const moduleRef = {
    get: jest.fn((token: unknown) =>
      typeof token === 'string' ? bots : websocket,
    ),
  };
  const processor = new ModelChangeOutboxProcessor(
    store,
    hive as never,
    moduleRef as unknown as ModuleRef,
  );
  return { processor, store, hive, websocket, bots };
}

describe('ModelChangeOutboxProcessor', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets only one of two processors claim and dispatch the same row', async () => {
    const shared = new MemoryOutboxStore();
    const first = setup(shared);
    const second = setup(shared);

    await Promise.all([
      first.processor.processOnce(),
      second.processor.processOnce(),
    ]);

    expect(
      first.hive.changeSessionModel.mock.calls.length +
        second.hive.changeSessionModel.mock.calls.length,
    ).toBe(1);
    expect(shared.dispatchStatus).toBe('dispatched');
  });

  it('reuses the attempt ID after a lost Hive HTTP response', async () => {
    const { processor, store, hive } = setup();
    hive.changeSessionModel
      .mockRejectedValueOnce(new Error('ECONNRESET after enqueue'))
      .mockResolvedValueOnce({ messageId: baseItem.attemptId });

    await processor.processOnce();
    await processor.processOnce();

    expect(hive.changeSessionModel).toHaveBeenCalledTimes(2);
    for (const call of hive.changeSessionModel.mock.calls) {
      expect(call[2]).toEqual({
        tenantId: baseItem.tenantId,
        idempotencyKey: baseItem.attemptId,
      });
    }
    expect(store.dispatchStatus).toBe('dispatched');
  });

  it('records bounded dispatch failures and retry age', async () => {
    const failureAdd = jest.fn();
    const retryRecord = jest.fn();
    jest
      .spyOn(appMetrics, 'modelChangeDispatchFailuresTotal', 'get')
      .mockReturnValue({ add: failureAdd } as never);
    jest
      .spyOn(appMetrics, 'modelChangeRetryAgeMs', 'get')
      .mockReturnValue({ record: retryRecord } as never);
    const { processor, hive } = setup();
    hive.changeSessionModel.mockRejectedValueOnce(new Error('ECONNRESET'));

    await processor.processOnce(new Date('2026-07-16T00:01:00.000Z'));

    expect(failureAdd).toHaveBeenCalledWith(1, {
      stage: 'dispatch',
      safe_error_code: 'hive_unavailable',
      terminal: 'false',
      application: 'common-staff',
      provider: 'openrouter',
    });
    expect(retryRecord).toHaveBeenCalledWith(60_000, {
      stage: 'dispatch',
      application: 'common-staff',
      provider: 'openrouter',
    });
  });

  it('recovers an expired claim after a process crashes before Hive', async () => {
    const store = new MemoryOutboxStore();
    store.status = 'processing';
    store.claimExpired = true;
    const { processor, hive } = setup(store);

    await processor.processOnce();

    expect(hive.changeSessionModel).toHaveBeenCalledTimes(1);
    expect(store.dispatchStatus).toBe('dispatched');
  });

  it('marks stable Hive protocol failures terminal without retrying', async () => {
    const { processor, store, hive } = setup();
    hive.changeSessionModel.mockRejectedValueOnce(
      new Error('Hive returned an unexpected model-change message ID'),
    );

    await processor.processOnce();

    expect(store.status).toBe('failed');
    expect(store.lastErrorCode).toBe('hive_protocol_error');
  });

  it('updates agent-pi before the local bot snapshot for bot defaults', async () => {
    const store = new MemoryOutboxStore();
    store.item = {
      ...baseItem,
      channelId: null,
      sessionId: null,
    };
    const { processor, hive, bots } = setup(store);

    await processor.processOnce();

    expect(hive.changeSessionModel).not.toHaveBeenCalled();
    expect(hive.updateAgent).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        tenantId: baseItem.tenantId,
        model: {
          provider: baseItem.requestedProvider,
          id: baseItem.requestedModelId,
        },
      }),
    );
    expect(bots.updateBotExtra).toHaveBeenCalledWith(
      baseItem.botId,
      expect.objectContaining({
        commonStaff: expect.objectContaining({
          model: {
            provider: baseItem.requestedProvider,
            id: baseItem.requestedModelId,
          },
        }),
      }),
    );
    expect(hive.updateAgent.mock.invocationCallOrder[0]).toBeLessThan(
      bots.updateBotExtra.mock.invocationCallOrder[0],
    );
  });

  it('repairs an unpublished dispatched row and emits one logical event', async () => {
    const store = new MemoryOutboxStore();
    store.status = 'dispatched';
    store.dispatchStatus = 'dispatched';
    const first = setup(store);
    const second = setup(store);

    await Promise.all([
      first.processor.processOnce(),
      second.processor.processOnce(),
    ]);
    await first.processor.processOnce();

    expect(
      first.websocket.sendToChannelMembers.mock.calls.length +
        second.websocket.sendToChannelMembers.mock.calls.length,
    ).toBe(1);
    const call =
      first.websocket.sendToChannelMembers.mock.calls[0] ??
      second.websocket.sendToChannelMembers.mock.calls[0];
    expect(call[2]).toMatchObject({
      attemptId: baseItem.attemptId,
      channelId: baseItem.channelId,
      model: {
        provider: baseItem.requestedProvider,
        id: baseItem.requestedModelId,
      },
    });
    expect(store.published).toBe(true);
  });
});
