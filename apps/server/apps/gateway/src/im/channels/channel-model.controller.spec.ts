import { describe, expect, it, jest } from '@jest/globals';
import { ModelSwitchNotAllowedException } from '../../model-policy/model-policy.errors.js';
import { ModelPolicyService } from '../../model-policy/model-policy.service.js';
import { ChannelModelController } from './channel-model.controller.js';

const allowedModel = {
  provider: 'openrouter',
  id: 'anthropic/claude-sonnet-4.6',
};
const target = {
  tenantId: 'tenant-1',
  agentId: 'agent-1',
  sessionId: 'session-1',
  botId: 'bot-1',
  botUserId: 'bot-user-1',
  installedApplicationId: 'installed-1',
  applicationId: 'common-staff',
  capability: 'staff' as const,
};

function setup() {
  const channels = {
    resolveModelTarget: jest.fn<any>().mockResolvedValue(target),
    resolveModelSwitchTarget: jest.fn<any>().mockResolvedValue(target),
  };
  const clawHive = {
    getSession: jest.fn<any>().mockResolvedValue({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelResolution: {
        agentDefault: allowedModel,
        sessionInitial: null,
        sessionDynamic: null,
        effective: allowedModel,
        source: 'agent_default',
      },
    }),
    getAgent: jest.fn<any>(),
    changeSessionModel: jest.fn<any>().mockResolvedValue(undefined),
  };
  const websocket = {
    sendToChannelMembers: jest.fn<any>().mockResolvedValue(undefined),
  };
  return {
    channels,
    clawHive,
    websocket,
    controller: new ChannelModelController(
      channels as never,
      clawHive as never,
      websocket as never,
      {} as never,
      new ModelPolicyService(),
    ),
  };
}

describe('ChannelModelController policy', () => {
  it('uses the read-only resolver for model reads', async () => {
    const { controller, channels } = setup();

    await expect(controller.getModel('user-1', 'channel-1')).resolves.toEqual({
      channelId: 'channel-1',
      model: allowedModel,
      source: 'agent_default',
      override: null,
    });
    expect(channels.resolveModelTarget).toHaveBeenCalled();
    expect(channels.resolveModelSwitchTarget).not.toHaveBeenCalled();
  });

  it('rejects fixed bots before Hive dispatch or websocket success', async () => {
    const { controller, channels, clawHive, websocket } = setup();
    channels.resolveModelSwitchTarget.mockRejectedValueOnce(
      new ModelSwitchNotAllowedException(),
    );

    await expect(
      controller.updateModel('user-1', 'channel-1', {
        model: allowedModel,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'model_switch_not_allowed' }),
    });
    expect(clawHive.changeSessionModel).not.toHaveBeenCalled();
    expect(websocket.sendToChannelMembers).not.toHaveBeenCalled();
  });

  it.each([
    { provider: 'custom', id: 'gpt-4' },
    { provider: 'anthropic', id: 'claude-3-opus' },
    { provider: 'http://evil.com', id: 'test' },
  ])('rejects unsupported pair %# before Hive dispatch', async (model) => {
    const { controller, clawHive, websocket } = setup();

    await expect(
      controller.updateModel('user-1', 'channel-1', { model }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'unsupported_model' }),
    });
    expect(clawHive.changeSessionModel).not.toHaveBeenCalled();
    expect(websocket.sendToChannelMembers).not.toHaveBeenCalled();
  });

  it('dispatches and emits only the approved catalog pair', async () => {
    const { controller, clawHive, websocket } = setup();

    await expect(
      controller.updateModel('user-1', 'channel-1', {
        model: {
          provider: ' openrouter ',
          id: ' anthropic/claude-sonnet-4.6 ',
        },
      }),
    ).resolves.toMatchObject({ model: allowedModel });
    expect(clawHive.changeSessionModel).toHaveBeenCalledWith(
      'session-1',
      allowedModel,
      'tenant-1',
    );
    expect(websocket.sendToChannelMembers).toHaveBeenCalledWith(
      'channel-1',
      expect.any(String),
      expect.objectContaining({ model: allowedModel }),
    );
  });
});
