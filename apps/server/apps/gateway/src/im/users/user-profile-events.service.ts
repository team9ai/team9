import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { WorkspaceService } from '../../workspace/workspace.service.js';
import {
  USER_PROFILE_EVENTS,
  type UserProfileUpdatedEvent,
} from './user-profile-events.js';

@Injectable()
export class UserProfileEventsService {
  constructor(
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    @Inject(forwardRef(() => WorkspaceService))
    private readonly workspaceService: WorkspaceService,
  ) {}

  @OnEvent(USER_PROFILE_EVENTS.UPDATED)
  async handleUserProfileUpdated(
    event: UserProfileUpdatedEvent,
  ): Promise<void> {
    const workspaceIds = await this.workspaceService.getWorkspaceIdsByUserId(
      event.userId,
    );

    for (const workspaceId of workspaceIds) {
      await this.websocketGateway.broadcastToWorkspace(
        workspaceId,
        WS_EVENTS.USER.UPDATED,
        { userId: event.userId },
      );
    }
  }
}
