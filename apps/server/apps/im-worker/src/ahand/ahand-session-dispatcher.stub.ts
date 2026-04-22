import { Injectable, Logger } from '@nestjs/common';

export interface AhandDispatchInput {
  ownerType: 'user' | 'workspace';
  ownerId: string;
  eventType: string;
  data: Record<string, unknown>;
}

/**
 * Stub for AhandSessionDispatcher.
 *
 * Task 5.4 (blocked by Barrier B-D-B) provides the real implementation.
 * This stub satisfies the compile-time dependency from AhandEventsSubscriber
 * so Tasks 5.1 and 5.3 can be committed without waiting for Stream B.
 *
 * The class name `AhandSessionDispatcher` is intentional — the spec file
 * and AhandModule will import this name, and Task 5.4 replaces the file
 * in place without changing import paths.
 */
@Injectable()
export class AhandSessionDispatcher {
  private readonly logger = new Logger(AhandSessionDispatcher.name);

  dispatch(_input: AhandDispatchInput): Promise<void> {
    this.logger.debug(
      '[stub] dispatch not yet implemented (Barrier B-D-B pending)',
    );
    return Promise.resolve();
  }
}
