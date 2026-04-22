import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { env } from '@team9/shared';
import { WorkspaceService } from '../workspace/workspace.service.js';

// Typed for documentation purposes; widened to string to prevent assignability
// errors when callers pass narrower literal union types (e.g. WebhookEventDto).
export type AhandEventType = string;

type OwnerType = 'user' | 'workspace';

/**
 * Emits ahand device events to Socket.io rooms `{ownerType}:{ownerId}:ahand`
 * using the im-namespace Redis adapter so any connected replica receives them.
 *
 * Clients join/leave rooms via `ahand:join_room` and `ahand:leave_room` events.
 * Membership is validated: a user may only join their own `user:{id}:ahand` room,
 * and may only join `workspace:{id}:ahand` if they are a member of that workspace.
 */
// CORS origin must be read lazily (at connection time) to avoid
// failing env reads during module import in test environments.
@WebSocketGateway({
  cors: {
    origin: (
      origin: string,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => {
      const allowed = env.CORS_ORIGIN;
      if (!allowed || allowed === '*') return cb(null, true);
      const origins = allowed.split(',').map((o) => o.trim());
      cb(null, origins.includes(origin));
    },
    credentials: true,
  },
  namespace: '/im',
})
export class AhandEventsGateway {
  private readonly logger = new Logger(AhandEventsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly workspaceService: WorkspaceService) {}

  emitToOwner(
    ownerType: OwnerType,
    ownerId: string,
    eventType: AhandEventType,
    data: Record<string, unknown>,
  ): void {
    const room = `${ownerType}:${ownerId}:ahand`;
    if (!this.server) {
      this.logger.warn(
        `Socket.io server not ready; cannot emit ${eventType} to ${room}`,
      );
      return;
    }
    this.server.to(room).emit(eventType, data);
  }

  @SubscribeMessage('ahand:join_room')
  async onJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const room = body?.room ?? '';
    const parsed = parseRoom(room);
    if (!parsed) return { ok: false, error: 'Invalid room format' };

    const authUser = (client as unknown as { user?: { sub: string } }).user;
    if (!authUser?.sub) return { ok: false, error: 'Unauthenticated' };

    if (parsed.ownerType === 'user') {
      if (parsed.ownerId !== authUser.sub) {
        return { ok: false, error: "Cannot join another user's room" };
      }
    } else {
      const member = await this.workspaceService.isWorkspaceMember(
        parsed.ownerId,
        authUser.sub,
      );
      if (!member)
        return { ok: false, error: 'Not a member of this workspace' };
    }

    await client.join(room);
    return { ok: true };
  }

  @SubscribeMessage('ahand:leave_room')
  async onLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room?: string },
  ): Promise<{ ok: boolean }> {
    await client.leave(body?.room ?? '');
    return { ok: true };
  }
}

function parseRoom(
  room: string,
): { ownerType: OwnerType; ownerId: string } | null {
  // ownerId matches UUIDs and any alphanumeric identifiers used in tests.
  const m = /^(user|workspace):([\w-]+):ahand$/.exec(room);
  if (!m) return null;
  return { ownerType: m[1] as OwnerType, ownerId: m[2] };
}
