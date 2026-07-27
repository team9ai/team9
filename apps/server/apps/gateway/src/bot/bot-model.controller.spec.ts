import { describe, expect, it, jest } from '@jest/globals';
import { ModelPolicyService } from '../model-policy/model-policy.service.js';
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

function setup(applicationId: string | null) {
  const botService = {
    getBotById: jest.fn().mockResolvedValue(bot(applicationId)),
    isActiveTenantMember: jest.fn().mockResolvedValue(true),
    updateBotExtra: jest.fn().mockResolvedValue(undefined),
  };
  const clawHive = {
    getAgent: jest.fn().mockResolvedValue({
      id: 'agent-1',
      name: 'Bot',
      blueprintId: 'team9-common-staff',
      model: allowedModel,
      tenantId: 'tenant-1',
      metadata: { tenantId: 'tenant-1' },
    }),
    updateAgent: jest.fn().mockResolvedValue(undefined),
  };
  return {
    botService,
    clawHive,
    controller: new BotModelController(
      botService as never,
      clawHive as never,
      new ModelPolicyService(),
    ),
  };
}

describe('BotModelController policy', () => {
  it('keeps fixed-bot model reads available', async () => {
    const { controller } = setup('base-model-staff');

    await expect(controller.getModel('user-1', 'bot-1')).resolves.toEqual({
      botId: 'bot-1',
      agentId: 'agent-1',
      model: allowedModel,
    });
  });

  it('rejects dynamic changes for fixed base-model bots', async () => {
    const { controller, clawHive, botService } = setup('base-model-staff');

    await expect(
      controller.updateModel('user-1', 'bot-1', { model: allowedModel }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'model_switch_not_allowed' }),
    });
    expect(clawHive.updateAgent).not.toHaveBeenCalled();
    expect(botService.updateBotExtra).not.toHaveBeenCalled();
  });

  it.each([null, 'unknown'])(
    'fails closed for application identity %p',
    async (applicationId) => {
      const { controller, clawHive } = setup(applicationId);

      await expect(
        controller.updateModel('user-1', 'bot-1', { model: allowedModel }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'model_policy_target_invalid',
        }),
      });
      expect(clawHive.updateAgent).not.toHaveBeenCalled();
    },
  );

  it.each([
    { provider: 'custom', id: 'gpt-4' },
    { provider: 'anthropic', id: 'claude-3-opus' },
    { provider: 'http://evil.com', id: 'test' },
  ])(
    'rejects unsupported pair %# before Hive or local mutation',
    async (model) => {
      const { controller, clawHive, botService } = setup('common-staff');

      await expect(
        controller.updateModel('user-1', 'bot-1', { model }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'unsupported_model' }),
      });
      expect(clawHive.updateAgent).not.toHaveBeenCalled();
      expect(botService.updateBotExtra).not.toHaveBeenCalled();
    },
  );

  it('passes only the approved pair to Hive and the local snapshot', async () => {
    const { controller, clawHive, botService } = setup('common-staff');

    await expect(
      controller.updateModel('user-1', 'bot-1', { model: allowedModel }),
    ).resolves.toMatchObject({ model: allowedModel });
    expect(clawHive.updateAgent).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ model: allowedModel }),
    );
    expect(botService.updateBotExtra).toHaveBeenCalledWith(
      'bot-1',
      expect.objectContaining({
        commonStaff: expect.objectContaining({ model: allowedModel }),
      }),
    );
  });
});
