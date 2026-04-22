import { describe, it, expect, jest } from '@jest/globals';

// Mock modules with JWT/env deps so Reflect.getMetadata can read @Module decorators.
jest.unstable_mockModule('../auth/auth.module.js', () => ({
  AuthModule: class AuthModule {},
}));
jest.unstable_mockModule('../workspace/workspace.module.js', () => ({
  WorkspaceModule: class WorkspaceModule {},
}));

const { AhandModule } = await import('./ahand.module.js');
const { AhandController } = await import('./ahand.controller.js');
const { AhandInternalController } =
  await import('./ahand-internal.controller.js');
const { AhandHubWebhookController } =
  await import('./ahand-webhook.controller.js');
const { AhandDevicesService } = await import('./ahand.service.js');
const { AhandHubClient } = await import('./ahand-hub.client.js');
const { AhandWebhookService } = await import('./ahand-webhook.service.js');
const { AhandRedisPublisher } =
  await import('./ahand-redis-publisher.service.js');
const { AhandEventsGateway } = await import('./ahand-events.gateway.js');

describe('AhandModule', () => {
  it('is constructable', () => {
    expect(AhandModule).toBeDefined();
  });

  it('declares all three controllers', () => {
    const meta = Reflect.getMetadata('controllers', AhandModule) as unknown[];
    expect(meta).toContain(AhandController);
    expect(meta).toContain(AhandInternalController);
    expect(meta).toContain(AhandHubWebhookController);
  });

  it('declares all five providers', () => {
    const meta = Reflect.getMetadata('providers', AhandModule) as unknown[];
    expect(meta).toContain(AhandDevicesService);
    expect(meta).toContain(AhandHubClient);
    expect(meta).toContain(AhandWebhookService);
    expect(meta).toContain(AhandRedisPublisher);
    expect(meta).toContain(AhandEventsGateway);
  });

  it('exports AhandDevicesService and AhandRedisPublisher', () => {
    const meta = Reflect.getMetadata('exports', AhandModule) as unknown[];
    expect(meta).toContain(AhandDevicesService);
    expect(meta).toContain(AhandRedisPublisher);
  });
});
