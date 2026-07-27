import { describe, expect, it, jest } from '@jest/globals';
import {
  ModelSwitchNotAllowedException,
  UnsupportedModelException,
} from '../../model-policy/model-policy.errors.js';
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
    changeSessionModel: jest.fn<any>(),
  };
  const modelChanges = {
    requestChannelModelChange: jest.fn<any>().mockResolvedValue({
      state: 'pending',
      attemptId: 'attempt-1',
    }),
  };
  const response = {
    status: jest.fn<any>().mockReturnThis(),
  };
  return {
    channels,
    clawHive,
    modelChanges,
    response,
    controller: new ChannelModelController(
      channels as never,
      clawHive as never,
      {} as never,
      modelChanges as never,
    ),
  };
}

describe('ChannelModelController durable mutation flow', () => {
  it('uses the read-only resolver for model reads', async () => {
    const { controller, channels } = setup();

    await expect(controller.getModel('user-1', 'channel-1')).resolves.toEqual({
      channelId: 'channel-1',
      model: allowedModel,
      source: 'agent_default',
      override: null,
    });
    expect(channels.resolveModelTarget).toHaveBeenCalled();
  });

  it('returns 202 for a durable pending attempt without direct Hive or websocket fanout', async () => {
    const { controller, response, modelChanges, clawHive } = setup();

    await expect(
      controller.updateModel(
        'user-1',
        'channel-1',
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
    expect(modelChanges.requestChannelModelChange).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      channelId: 'channel-1',
      idempotencyKey: 'request-1',
      model: allowedModel,
    });
    expect(clawHive.changeSessionModel).not.toHaveBeenCalled();
  });

  it('returns 200 only after processor-confirmed dispatch', async () => {
    const { controller, response, modelChanges, clawHive } = setup();
    modelChanges.requestChannelModelChange.mockResolvedValueOnce({
      state: 'dispatched',
      attemptId: 'attempt-1',
      model: allowedModel,
    });

    await expect(
      controller.updateModel(
        'user-1',
        'channel-1',
        { model: allowedModel },
        'request-1',
        response as never,
      ),
    ).resolves.toMatchObject({
      channelId: 'channel-1',
      model: allowedModel,
      attemptId: 'attempt-1',
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(clawHive.changeSessionModel).not.toHaveBeenCalled();
  });

  it.each([
    new ModelSwitchNotAllowedException(),
    new UnsupportedModelException(),
  ])(
    'does not bypass command rejection with direct dispatch',
    async (error) => {
      const { controller, response, modelChanges, clawHive } = setup();
      modelChanges.requestChannelModelChange.mockRejectedValueOnce(error);

      await expect(
        controller.updateModel(
          'user-1',
          'channel-1',
          { model: allowedModel },
          'request-1',
          response as never,
        ),
      ).rejects.toBe(error);
      expect(clawHive.changeSessionModel).not.toHaveBeenCalled();
    },
  );

  it('generates and returns a bounded fallback idempotency key', async () => {
    const { controller, response, modelChanges } = setup();

    const result = await controller.updateModel(
      'user-1',
      'channel-1',
      { model: allowedModel },
      undefined,
      response as never,
    );

    expect(result.idempotencyKey).toEqual(expect.any(String));
    expect(result.idempotencyKey.length).toBeLessThanOrEqual(128);
    expect(modelChanges.requestChannelModelChange).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: result.idempotencyKey }),
    );
  });
});
