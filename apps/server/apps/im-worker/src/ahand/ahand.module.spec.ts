import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('@team9/redis', () => ({
  RedisModule: class RedisModule {},
  REDIS_CLIENT: 'REDIS_CLIENT',
  RedisType: {},
}));

const { AhandImWorkerModule } = await import('./ahand.module.js');
const { AhandControlPlaneClient } =
  await import('./ahand-control-plane.client.js');
const { AhandBlueprintExtender } =
  await import('./ahand-blueprint.extender.js');
const { AhandSessionTrackingService } =
  await import('./ahand-session-tracking.service.js');
const { AhandSessionDispatcher } =
  await import('./ahand-session-dispatcher.service.js');
const { AhandEventsSubscriber } = await import('./ahand-events.subscriber.js');

describe('AhandImWorkerModule', () => {
  it('is constructable', () => {
    expect(AhandImWorkerModule).toBeDefined();
  });

  it('declares all five providers', () => {
    const meta = Reflect.getMetadata(
      'providers',
      AhandImWorkerModule,
    ) as unknown[];
    expect(meta).toContain(AhandControlPlaneClient);
    expect(meta).toContain(AhandBlueprintExtender);
    expect(meta).toContain(AhandSessionTrackingService);
    expect(meta).toContain(AhandSessionDispatcher);
    expect(meta).toContain(AhandEventsSubscriber);
  });

  it('exports AhandBlueprintExtender and AhandSessionTrackingService', () => {
    const meta = Reflect.getMetadata(
      'exports',
      AhandImWorkerModule,
    ) as unknown[];
    expect(meta).toContain(AhandBlueprintExtender);
    expect(meta).toContain(AhandSessionTrackingService);
  });
});
