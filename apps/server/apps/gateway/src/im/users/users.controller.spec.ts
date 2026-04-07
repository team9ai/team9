import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule(
  '../../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenantId: () => () => undefined,
  }),
);

jest.unstable_mockModule('../websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
}));

jest.unstable_mockModule('../../workspace/workspace.service.js', () => ({
  WorkspaceService: class WorkspaceService {},
}));

const { UsersController } = await import('./users.controller.js');
const { WS_EVENTS } = await import('../websocket/events/events.constants.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    search: MockFn;
    getOnlineUsers: MockFn;
    findByIdOrThrow: MockFn;
    update: MockFn;
    updateStatus: MockFn;
  };
  let websocketGateway: {
    broadcastToWorkspace: MockFn;
  };
  let workspaceService: {
    getWorkspaceIdsByUserId: MockFn;
  };

  beforeEach(() => {
    usersService = {
      search: jest.fn<any>().mockResolvedValue([{ id: 'user-1' }]),
      getOnlineUsers: jest.fn<any>().mockResolvedValue({ 'user-1': 'online' }),
      findByIdOrThrow: jest.fn<any>().mockResolvedValue({ id: 'user-1' }),
      update: jest.fn<any>().mockResolvedValue({ id: 'user-1' }),
      updateStatus: jest.fn<any>().mockResolvedValue(undefined),
    };

    websocketGateway = {
      broadcastToWorkspace: jest.fn<any>().mockResolvedValue(undefined),
    };

    workspaceService = {
      getWorkspaceIdsByUserId: jest
        .fn<any>()
        .mockResolvedValue(['workspace-1', 'workspace-2']),
    };

    controller = new UsersController(
      usersService as never,
      websocketGateway as never,
      workspaceService as never,
    );
  });

  it('searches users with parsed limit and tenant scope', async () => {
    await expect(
      controller.search('user-1', 'alice', '25', 'tenant-1'),
    ).resolves.toEqual([{ id: 'user-1' }]);

    expect(usersService.search).toHaveBeenCalledWith(
      'alice',
      25,
      'tenant-1',
      'user-1',
    );
  });

  it('searches with empty query and default limit when query params are missing', async () => {
    await controller.search('user-1', undefined as never, undefined, undefined);

    expect(usersService.search).toHaveBeenCalledWith(
      '',
      20,
      undefined,
      'user-1',
    );
  });

  it('returns online users', async () => {
    await expect(controller.getOnlineUsers()).resolves.toEqual({
      'user-1': 'online',
    });

    expect(usersService.getOnlineUsers).toHaveBeenCalledTimes(1);
  });

  it('loads a user by id', async () => {
    await expect(controller.getUser('user-1')).resolves.toEqual({
      id: 'user-1',
    });

    expect(usersService.findByIdOrThrow).toHaveBeenCalledWith('user-1');
  });

  it('updates the current user profile', async () => {
    const dto = { displayName: 'Alice' };

    await expect(controller.updateMe('user-1', dto as never)).resolves.toEqual({
      id: 'user-1',
    });

    expect(usersService.update).toHaveBeenCalledWith('user-1', dto);
  });

  it('updates user status and broadcasts to every workspace membership', async () => {
    await expect(
      controller.updateStatus('user-1', { status: 'busy' } as never),
    ).resolves.toEqual({ success: true });

    expect(usersService.updateStatus).toHaveBeenCalledWith('user-1', 'busy');
    expect(workspaceService.getWorkspaceIdsByUserId).toHaveBeenCalledWith(
      'user-1',
    );
    expect(websocketGateway.broadcastToWorkspace).toHaveBeenNthCalledWith(
      1,
      'workspace-1',
      WS_EVENTS.USER.STATUS_CHANGED,
      {
        userId: 'user-1',
        status: 'busy',
      },
    );
    expect(websocketGateway.broadcastToWorkspace).toHaveBeenNthCalledWith(
      2,
      'workspace-2',
      WS_EVENTS.USER.STATUS_CHANGED,
      {
        userId: 'user-1',
        status: 'busy',
      },
    );
  });
});
