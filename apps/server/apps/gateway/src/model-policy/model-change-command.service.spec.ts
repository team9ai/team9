import { describe, expect, it, jest } from '@jest/globals';
import { ModelSwitchNotAllowedException } from './model-policy.errors.js';
import { ModelPolicyService } from './model-policy.service.js';
import { ModelChangeCommandService } from './model-change-command.service.js';

const allowedModel = {
  provider: 'openrouter',
  id: 'anthropic/claude-sonnet-4.6',
};

function setup() {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  let existing: Record<string, unknown> | null = null;
  let insertError: Error | null = null;
  const db = {
    select: jest.fn<any>().mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => (existing ? [existing] : []),
        }),
      }),
    })),
    insert: jest.fn<any>().mockImplementation((table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (insertError) throw insertError;
        inserted.push({ table, values });
      },
    })),
    transaction: jest
      .fn<any>()
      .mockImplementation(async (callback) => callback(db)),
  };
  const channels = {
    resolveModelSwitchTarget: jest.fn<any>().mockResolvedValue({
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      sessionId: 'session-1',
      botId: 'bot-1',
      botUserId: 'bot-user-1',
      installedApplicationId: 'installed-1',
      applicationId: 'common-staff',
      capability: 'staff',
    }),
  };
  const bots = {
    getBotById: jest.fn<any>(),
    isActiveTenantMember: jest.fn<any>(),
  };
  const service = new ModelChangeCommandService(
    db as never,
    channels as never,
    bots as never,
    new ModelPolicyService(),
  );
  return {
    service,
    db,
    channels,
    bots,
    inserted,
    setExisting(value: Record<string, unknown>) {
      existing = value;
    },
    failInserts(error: Error) {
      insertError = error;
    },
  };
}

describe('ModelChangeCommandService', () => {
  it('persists a rejected decision before rethrowing the policy error', async () => {
    const { service, channels, inserted } = setup();
    channels.resolveModelSwitchTarget.mockRejectedValueOnce(
      new ModelSwitchNotAllowedException(),
    );

    await expect(
      service.requestChannelModelChange({
        actorUserId: 'user-1',
        channelId: 'channel-1',
        idempotencyKey: 'request-1',
        model: allowedModel,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'model_switch_not_allowed' }),
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].values).toMatchObject({
      idempotencyKey: 'request-1',
      decision: 'rejected',
      reasonCode: 'model_switch_not_allowed',
      dispatchStatus: 'not_applicable',
    });
  });

  it('atomically inserts one accepted attempt and one pending outbox row', async () => {
    const { service, db, inserted } = setup();

    await expect(
      service.requestChannelModelChange({
        actorUserId: 'user-1',
        channelId: 'channel-1',
        idempotencyKey: 'request-1',
        correlationId: 'correlation-1',
        model: allowedModel,
      }),
    ).resolves.toMatchObject({
      state: 'pending',
      attemptId: expect.any(String),
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(inserted).toHaveLength(2);
    expect(inserted[0].values).toMatchObject({
      decision: 'accepted',
      dispatchStatus: 'pending',
      requestedProvider: allowedModel.provider,
      requestedModelId: allowedModel.id,
      catalogVersion: '2026-07-16.1',
    });
    expect(inserted[1].values).toMatchObject({
      attemptId: inserted[0].values.id,
      status: 'pending',
    });
  });

  it('returns an existing identical attempt without another insert', async () => {
    const { service, channels, inserted, setExisting } = setup();
    setExisting({
      id: 'attempt-1',
      actorUserId: 'user-1',
      channelId: 'channel-1',
      botId: 'bot-1',
      requestedProvider: allowedModel.provider,
      requestedModelId: allowedModel.id,
      dispatchStatus: 'pending',
      decision: 'accepted',
    });

    await expect(
      service.requestChannelModelChange({
        actorUserId: 'user-1',
        channelId: 'channel-1',
        idempotencyKey: 'request-1',
        model: allowedModel,
      }),
    ).resolves.toEqual({ state: 'pending', attemptId: 'attempt-1' });
    expect(channels.resolveModelSwitchTarget).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('rejects reuse of an idempotency key with different input', async () => {
    const { service, inserted, setExisting } = setup();
    setExisting({
      id: 'attempt-1',
      actorUserId: 'user-1',
      channelId: 'channel-1',
      botId: 'bot-1',
      requestedProvider: allowedModel.provider,
      requestedModelId: allowedModel.id,
      dispatchStatus: 'pending',
      decision: 'accepted',
    });

    await expect(
      service.requestChannelModelChange({
        actorUserId: 'user-1',
        channelId: 'channel-1',
        idempotencyKey: 'request-1',
        model: { provider: 'openrouter', id: 'openai/gpt-5.5' },
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'idempotency_conflict' }),
    });
    expect(inserted).toHaveLength(0);
  });

  it('fails closed with 503 when rejection audit storage is unavailable', async () => {
    const { service, channels, failInserts } = setup();
    channels.resolveModelSwitchTarget.mockRejectedValueOnce(
      new ModelSwitchNotAllowedException(),
    );
    failInserts(new Error('database down'));

    await expect(
      service.requestChannelModelChange({
        actorUserId: 'user-1',
        channelId: 'channel-1',
        idempotencyKey: 'request-1',
        model: allowedModel,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'model_change_audit_unavailable',
      }),
    });
  });
});
