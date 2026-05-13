import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  inArray,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { WorkspaceService } from '../../workspace/workspace.service.js';
import {
  USER_PROFILE_EVENTS,
  type UserProfileUpdatedEvent,
} from './user-profile-events.js';
import { REDIS_KEYS } from '../shared/constants/redis-keys.js';

@Injectable()
export class UserProfileEventsService {
  constructor(
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    @Inject(forwardRef(() => WorkspaceService))
    private readonly workspaceService: WorkspaceService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  @OnEvent(USER_PROFILE_EVENTS.UPDATED)
  async handleUserProfileUpdated(
    event: UserProfileUpdatedEvent,
  ): Promise<void> {
    await this.invalidateProfileCaches(event.userId);

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

  private async invalidateProfileCaches(userId: string): Promise<void> {
    const keys = new Set<string>([REDIS_KEYS.USER_CACHE(userId)]);

    const oneOnOneChannels = await this.db
      .select({ channelId: schema.channelMembers.channelId })
      .from(schema.channelMembers)
      .innerJoin(
        schema.channels,
        eq(schema.channels.id, schema.channelMembers.channelId),
      )
      .where(
        and(
          eq(schema.channelMembers.userId, userId),
          isNull(schema.channelMembers.leftAt),
          inArray(schema.channels.type, [
            'direct',
            'routine-session',
            'topic-session',
          ]),
        ),
      );

    const channelIds = [
      ...new Set(oneOnOneChannels.map((row) => row.channelId)),
    ];

    if (channelIds.length > 0) {
      const channelMembers = await this.db
        .select({
          channelId: schema.channelMembers.channelId,
          userId: schema.channelMembers.userId,
        })
        .from(schema.channelMembers)
        .where(
          and(
            inArray(schema.channelMembers.channelId, channelIds),
            isNull(schema.channelMembers.leftAt),
          ),
        );

      for (const member of channelMembers) {
        keys.add(
          REDIS_KEYS.CHANNEL_DM_OTHER_USER(member.channelId, member.userId),
        );
      }
    }

    await this.redisService.invalidate(...keys);
  }
}
