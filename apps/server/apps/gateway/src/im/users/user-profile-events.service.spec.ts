import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
}));

jest.unstable_mockModule('../../workspace/workspace.service.js', () => ({
  WorkspaceService: class WorkspaceService {},
}));

const { UserProfileEventsService } =
  await import('./user-profile-events.service.js');
const { WS_EVENTS } = await import('../websocket/events/events.constants.js');
const { REDIS_KEYS } = await import('../shared/constants/redis-keys.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('UserProfileEventsService', () => {
  let service: InstanceType<typeof UserProfileEventsService>;
  let websocketGateway: { broadcastToWorkspace: MockFn };
  let workspaceService: { getWorkspaceIdsByUserId: MockFn };
  let db: { select: MockFn; __results: unknown[][] };
  let redisService: { invalidate: MockFn };

  const makeDb = () => {
    const results: unknown[][] = [];
    const dbMock = {
      __results: results,
      select: jest.fn<any>(() => {
        const query = {
          from: jest.fn<any>(() => query),
          innerJoin: jest.fn<any>(() => query),
          where: jest.fn<any>(() => Promise.resolve(results.shift() ?? [])),
        };
        return query;
      }),
    };
    return dbMock;
  };

  beforeEach(() => {
    websocketGateway = {
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
    };
    workspaceService = {
      getWorkspaceIdsByUserId: jest
        .fn<any>()
        .mockResolvedValue(['workspace-1', 'workspace-2']),
    };
    db = makeDb();
    redisService = {
      invalidate: jest.fn<any>().mockResolvedValue(0),
    };

    service = new (UserProfileEventsService as any)(
      websocketGateway as never,
      workspaceService as never,
      db,
      redisService,
    );
  });

  it('broadcasts user_updated to every workspace containing the updated user', async () => {
    await service.handleUserProfileUpdated({ userId: 'user-1' });

    expect(workspaceService.getWorkspaceIdsByUserId).toHaveBeenCalledWith(
      'user-1',
    );
    expect(websocketGateway.broadcastToWorkspace).toHaveBeenNthCalledWith(
      1,
      'workspace-1',
      WS_EVENTS.USER.UPDATED,
      { userId: 'user-1' },
    );
    expect(websocketGateway.broadcastToWorkspace).toHaveBeenNthCalledWith(
      2,
      'workspace-2',
      WS_EVENTS.USER.UPDATED,
      { userId: 'user-1' },
    );
  });

  it('invalidates cached user and one-on-one channel summaries before broadcasting', async () => {
    db.__results.push(
      [{ channelId: 'dm-1' }, { channelId: 'topic-1' }, { channelId: 'dm-1' }],
      [
        { channelId: 'dm-1', userId: 'human-1' },
        { channelId: 'dm-1', userId: 'bot-1' },
        { channelId: 'topic-1', userId: 'human-1' },
        { channelId: 'topic-1', userId: 'bot-1' },
      ],
    );

    await service.handleUserProfileUpdated({ userId: 'bot-1' });

    expect(redisService.invalidate).toHaveBeenCalledWith(
      REDIS_KEYS.USER_CACHE('bot-1'),
      REDIS_KEYS.CHANNEL_DM_OTHER_USER('dm-1', 'human-1'),
      REDIS_KEYS.CHANNEL_DM_OTHER_USER('dm-1', 'bot-1'),
      REDIS_KEYS.CHANNEL_DM_OTHER_USER('topic-1', 'human-1'),
      REDIS_KEYS.CHANNEL_DM_OTHER_USER('topic-1', 'bot-1'),
    );
    expect(websocketGateway.broadcastToWorkspace).toHaveBeenCalled();
  });
});
