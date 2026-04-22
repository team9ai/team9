import { Injectable, Logger } from '@nestjs/common';

// Typed for documentation; widened to string so callers with narrower union types
// (e.g. WebhookEventDto.eventType) are assignable without explicit cast.
export type AhandEventType = string;

/**
 * Emits ahand device events on the Socket.io room `{ownerType}:{ownerId}:ahand`.
 *
 * Task 4.7 wires this into the existing Socket.io server instance. This stub
 * exposes the `emitToOwner` API so Task 4.6 (AhandWebhookService) can call it
 * at compile time without a circular dependency on the full WebSocket gateway.
 */
@Injectable()
export class AhandEventsGateway {
  private readonly logger = new Logger(AhandEventsGateway.name);

  // Populated by AhandModule.onModuleInit() once the WebSocket server is ready.
  private server: {
    to: (room: string) => { emit: (event: string, data: unknown) => void };
  } | null = null;

  attachServer(server: {
    to: (room: string) => { emit: (event: string, data: unknown) => void };
  }): void {
    this.server = server;
  }

  emitToOwner(
    ownerType: 'user' | 'workspace',
    ownerId: string,
    eventType: AhandEventType,
    data: Record<string, unknown>,
  ): void {
    const room = `${ownerType}:${ownerId}:ahand`;
    if (!this.server) {
      this.logger.warn(
        `Socket.io server not attached; cannot emit ${eventType} to ${room}`,
      );
      return;
    }
    this.server.to(room).emit(`ahand:${eventType}`, data);
  }
}
