import { describe, expect, it, jest } from '@jest/globals';
import {
  ModelPolicyTargetInvalidException,
  ModelSwitchNotAllowedException,
  UnsupportedModelException,
} from '../model-policy/model-policy.errors.js';
import { BotModelController } from './bot-model.controller.js';

const allowedModel = {
  provider: 'openrouter',
  id: 'anthropic/claude-sonnet-4.6',
};

function bot(applicationId: string | null) {
  return {
    botId: 'bot-1',
    userId: 'bot-user-1',
    username: 'bot',
    displayName: 'Bot',
    email: 'bot@example.com',
    type: 'system',
    ownerId: 'user-1',
    mentorId: 'user-1',
    description: null,
    capabilities: null,
    extra: { commonStaff: { model: allowedModel } },
    managedProvider: 'hive',
    managedMeta: { agentId: 'agent-1' },
    isActive: true,
    installedApplicationId: applicationId ? 'installed-1' : null,
    applicationId,
    tenantId: 'tenant-1',
  };
}

function setup(applicationId: string | null = 'common-staff') {
  const botService = {
    getBotById: jest.fn<any>().mockResolvedValue(bot(applicationId)),
    isActiveTenantMember: jest.fn<any>().mockResolvedValue(true),
    updateBotExtra: jest.fn<any>(),
  };
  const clawHive = {
    getAgent: jest.fn<any>().mockResolvedValue({
      id: 'agent-1',
      name: 'Bot',
      blueprintId: 'team9-common-staff',
      model: allowedModel,
      tenantId: 'tenant-1',
      metadata: { tenantId: 'tenant-1' },
    }),
    updateAgent: jest.fn<any>(),
  };
  const modelChanges = {
    requestBotModelChange: jest.fn<any>().mockResolvedValue({
      state: 'pending',
      attemptId: 'attempt-1',
    }),
  };
  const response = {
    status: jest.fn<any>().mockReturnThis(),
  };
  return {
    botService,
    clawHive,
    modelChanges,
    response,
    controller: new BotModelController(
      botService as never,
      clawHive as never,
      modelChanges as never,
    ),
  };
}

describe('BotModelController durable mutation flow', () => {
  it('keeps fixed-bot model reads available', async () => {
    const { controller } = setup('base-model-staff');

    await expect(controller.getModel('user-1', 'bot-1')).resolves.toEqual({
      botId: 'bot-1',
      agentId: 'agent-1',
      model: allowedModel,
    });
  });

  it('returns 202 while the durable bot-default mutation is pending', async () => {
    const { controller, response, modelChanges, clawHive, botService } =
      setup();

    await expect(
      controller.updateModel(
        'user-1',
        'bot-1',
        { model: allowedModel },
        'request-1',
        response as never,
      ),
    ).resolves.toEqual({
      attemptId: 'attempt-1',
      idempotencyKey: 'request-1',
      statusUrl: '/api/v1/model-changes/attempt-1',
    });
    expect(response.status).toHaveBeenCalledWith(202);
    expect(modelChanges.requestBotModelChange).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      botId: 'bot-1',
      idempotencyKey: 'request-1',
      model: allowedModel,
    });
    expect(clawHive.updateAgent).not.toHaveBeenCalled();
    expect(botService.updateBotExtra).not.toHaveBeenCalled();
  });

  it('returns 200 only after processor-confirmed Hive and snapshot updates', async () => {
    const { controller, response, modelChanges, clawHive, botService } =
      setup();
    modelChanges.requestBotModelChange.mockResolvedValueOnce({
      state: 'dispatched',
      attemptId: 'attempt-1',
      model: allowedModel,
    });

    await expect(
      controller.updateModel(
        'user-1',
        'bot-1',
        { model: allowedModel },
        'request-1',
        response as never,
      ),
    ).resolves.toMatchObject({
      botId: 'bot-1',
      agentId: 'agent-1',
      model: allowedModel,
      attemptId: 'attempt-1',
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(clawHive.updateAgent).not.toHaveBeenCalled();
    expect(botService.updateBotExtra).not.toHaveBeenCalled();
  });

  it.each([
    new ModelSwitchNotAllowedException(),
    new ModelPolicyTargetInvalidException(),
    new UnsupportedModelException(),
  ])(
    'never performs controller-owned writes after rejection',
    async (error) => {
      const { controller, response, modelChanges, clawHive, botService } =
        setup();
      modelChanges.requestBotModelChange.mockRejectedValueOnce(error);

      await expect(
        controller.updateModel(
          'user-1',
          'bot-1',
          { model: allowedModel },
          'request-1',
          response as never,
        ),
      ).rejects.toBe(error);
      expect(clawHive.updateAgent).not.toHaveBeenCalled();
      expect(botService.updateBotExtra).not.toHaveBeenCalled();
    },
  );
});
