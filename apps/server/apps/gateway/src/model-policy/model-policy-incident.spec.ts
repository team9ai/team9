import { describe, expect, it, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import * as schema from '@team9/database/schemas';
import { ModelChangeCommandService } from './model-change-command.service.js';
import { ModelPolicyService } from './model-policy.service.js';

const incidentModels = [
  { provider: 'custom', id: 'gpt-4' },
  { provider: 'anthropic', id: 'claude-3-opus' },
  { provider: 'http://evil.com', id: 'test' },
  { provider: 'openrouter', id: 'openai/gpt-5.5' },
] as const;

function exceptionCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  return typeof response === 'object' && response !== null
    ? String((response as { code?: unknown }).code)
    : undefined;
}

function setup(input: {
  channelApplicationId: string;
  botApplicationId: string;
}) {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const db = {
    select: jest.fn<any>().mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    })),
    insert: jest.fn<any>().mockImplementation((table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        inserted.push({ table, values });
      },
    })),
    transaction: jest
      .fn<any>()
      .mockImplementation(async (callback) => callback(db)),
  };
  const channels = {
    resolveModelManageTarget: jest.fn<any>().mockResolvedValue({
      tenantId: 'tenant-1',
      agentId: 'base-model-chatgpt-tenant-1',
      sessionId: 'session-1',
      botId: 'bot-1',
      botUserId: 'bot-user-1',
      installedApplicationId: 'installed-channel-1',
      applicationId: input.channelApplicationId,
    }),
  };
  const bots = {
    getBotById: jest.fn<any>().mockResolvedValue({
      botId: 'bot-2',
      userId: 'bot-user-2',
      ownerId: 'user-1',
      mentorId: 'user-1',
      tenantId: 'tenant-1',
      installedApplicationId: 'installed-bot-1',
      applicationId: input.botApplicationId,
      managedProvider: 'hive',
      managedMeta: { agentId: 'base-model-chatgpt-tenant-1' },
      extra: { commonStaff: { model: incidentModels[3] } },
    }),
    isActiveTenantMember: jest.fn<any>().mockResolvedValue(true),
    updateBotExtra: jest.fn<any>(),
  };
  const hive = {
    changeSessionModel: jest.fn<any>(),
    updateAgent: jest.fn<any>(),
  };
  const websocket = {
    sendToChannelMembers: jest.fn<any>(),
  };
  const moduleRef = { get: jest.fn(() => bots) };
  const outboxProcessor = {
    tryDispatch: jest.fn<any>().mockResolvedValue('pending'),
  };
  const service = new ModelChangeCommandService(
    db as never,
    channels as never,
    new ModelPolicyService(),
    moduleRef as never,
    outboxProcessor as never,
  );

  return {
    service,
    inserted,
    outboxProcessor,
    hive,
    websocket,
    bots,
  };
}

async function expectCode(
  promise: Promise<unknown>,
  expected: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ${expected}`);
  } catch (error) {
    expect(exceptionCode(error)).toBe(expected);
  }
}

describe('model policy incident regression', () => {
  it('rejects every fixed-bot mutation with one sanitized audit and no dispatch side effects', async () => {
    const harness = setup({
      channelApplicationId: 'base-model-staff',
      botApplicationId: 'base-model-staff',
    });

    for (const [index, model] of incidentModels.entries()) {
      await expectCode(
        harness.service.requestChannelModelChange({
          actorUserId: 'user-1',
          channelId: 'channel-1',
          idempotencyKey: `fixed-channel-${index}`,
          model,
        }),
        'model_switch_not_allowed',
      );
      await expectCode(
        harness.service.requestBotModelChange({
          actorUserId: 'user-1',
          botId: 'bot-2',
          idempotencyKey: `fixed-bot-${index}`,
          model,
        }),
        'model_switch_not_allowed',
      );
    }

    const attempts = harness.inserted.filter(
      (row) => row.table === schema.modelChangeAttempts,
    );
    const outbox = harness.inserted.filter(
      (row) => row.table === schema.modelChangeOutbox,
    );
    expect(attempts).toHaveLength(incidentModels.length * 2);
    expect(outbox).toHaveLength(0);
    for (const attempt of attempts) {
      expect(attempt.values).toMatchObject({
        applicationId: 'base-model-staff',
        decision: 'rejected',
        reasonCode: 'model_switch_not_allowed',
        dispatchStatus: 'not_applicable',
      });
      expect(
        Array.from(String(attempt.values.requestedProvider)).some(
          (character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint <= 31 || codePoint === 127;
          },
        ),
      ).toBe(false);
      expect(
        String(attempt.values.requestedProvider).length,
      ).toBeLessThanOrEqual(128);
      expect(
        String(attempt.values.requestedModelId).length,
      ).toBeLessThanOrEqual(256);
    }
    expect(harness.outboxProcessor.tryDispatch).not.toHaveBeenCalled();
    expect(harness.hive.changeSessionModel).not.toHaveBeenCalled();
    expect(harness.hive.updateAgent).not.toHaveBeenCalled();
    expect(harness.bots.updateBotExtra).not.toHaveBeenCalled();
    expect(harness.websocket.sendToChannelMembers).not.toHaveBeenCalled();
  });

  it('rejects unsupported dynamic pairs and durably accepts a catalog pair', async () => {
    const harness = setup({
      channelApplicationId: 'common-staff',
      botApplicationId: 'personal-staff',
    });

    for (const [index, model] of incidentModels.slice(0, 3).entries()) {
      await expectCode(
        harness.service.requestChannelModelChange({
          actorUserId: 'user-1',
          channelId: 'channel-1',
          idempotencyKey: `dynamic-channel-rejected-${index}`,
          model,
        }),
        'unsupported_model',
      );
      await expectCode(
        harness.service.requestBotModelChange({
          actorUserId: 'user-1',
          botId: 'bot-2',
          idempotencyKey: `dynamic-bot-rejected-${index}`,
          model,
        }),
        'unsupported_model',
      );
    }

    await expect(
      harness.service.requestChannelModelChange({
        actorUserId: 'user-1',
        channelId: 'channel-1',
        idempotencyKey: 'dynamic-channel-accepted',
        model: incidentModels[3],
      }),
    ).resolves.toMatchObject({ state: 'pending' });
    await expect(
      harness.service.requestBotModelChange({
        actorUserId: 'user-1',
        botId: 'bot-2',
        idempotencyKey: 'dynamic-bot-accepted',
        model: incidentModels[3],
      }),
    ).resolves.toMatchObject({ state: 'pending' });

    const attempts = harness.inserted.filter(
      (row) => row.table === schema.modelChangeAttempts,
    );
    const outbox = harness.inserted.filter(
      (row) => row.table === schema.modelChangeOutbox,
    );
    expect(
      attempts.filter((row) => row.values.reasonCode === 'unsupported_model'),
    ).toHaveLength(6);
    expect(
      attempts.filter((row) => row.values.decision === 'accepted'),
    ).toHaveLength(2);
    expect(outbox).toHaveLength(2);
    expect(harness.outboxProcessor.tryDispatch).toHaveBeenCalledTimes(2);
  });
});
