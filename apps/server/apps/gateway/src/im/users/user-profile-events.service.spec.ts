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

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('UserProfileEventsService', () => {
  let service: InstanceType<typeof UserProfileEventsService>;
  let websocketGateway: { broadcastToWorkspace: MockFn };
  let workspaceService: { getWorkspaceIdsByUserId: MockFn };

  beforeEach(() => {
    websocketGateway = {
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
    };
    workspaceService = {
      getWorkspaceIdsByUserId: jest
        .fn<any>()
        .mockResolvedValue(['workspace-1', 'workspace-2']),
    };

    service = new UserProfileEventsService(
      websocketGateway as never,
      workspaceService as never,
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
});
