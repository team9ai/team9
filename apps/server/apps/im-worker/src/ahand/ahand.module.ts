import { Module } from '@nestjs/common';
import { RedisModule } from '@team9/redis';
import { AhandControlPlaneClient } from './ahand-control-plane.client.js';
import { AhandBlueprintExtender } from './ahand-blueprint.extender.js';
import { AhandSessionTrackingService } from './ahand-session-tracking.service.js';
import { AhandSessionDispatcher } from './ahand-session-dispatcher.service.js';
import { AhandEventsSubscriber } from './ahand-events.subscriber.js';

@Module({
  imports: [RedisModule],
  providers: [
    AhandControlPlaneClient,
    AhandBlueprintExtender,
    AhandSessionTrackingService,
    AhandSessionDispatcher,
    AhandEventsSubscriber,
  ],
  exports: [AhandBlueprintExtender, AhandSessionTrackingService],
})
export class AhandImWorkerModule {}
