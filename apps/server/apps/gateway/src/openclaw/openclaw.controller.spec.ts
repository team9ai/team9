import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { OpenclawController } from './openclaw.controller.js';

describe('OpenclawController', () => {
  let openclawService: {
    searchInstances: jest.Mock<any>;
    getWorkspaceLastMessage: jest.Mock<any>;
    getWorkspacesLastMessages: jest.Mock<any>;
    getAllInstanceActivity: jest.Mock<any>;
    getInstanceConversations: jest.Mock<any>;
    getConversationMessages: jest.Mock<any>;
  };
  let controller: OpenclawController;

  beforeEach(() => {
    openclawService = {
      searchInstances: jest.fn<any>().mockResolvedValue(['instance-1']),
      getWorkspaceLastMessage: jest
        .fn<any>()
        .mockResolvedValue({ id: 'message-1' }),
      getWorkspacesLastMessages: jest
        .fn<any>()
        .mockResolvedValue([{ id: 'message-1' }]),
      getAllInstanceActivity: jest.fn<any>().mockResolvedValue(['active']),
      getInstanceConversations: jest
        .fn<any>()
        .mockResolvedValue([{ id: 'channel-1' }]),
      getConversationMessages: jest
        .fn<any>()
        .mockResolvedValue([{ id: 'message-1' }]),
    };
    controller = new OpenclawController(openclawService as never);
  });

  it('searches instances and defaults empty queries to an empty string', async () => {
    await expect(controller.searchInstances('bot')).resolves.toEqual([
      'instance-1',
    ]);
    await expect(
      controller.searchInstances(undefined as never),
    ).resolves.toEqual(['instance-1']);

    expect(openclawService.searchInstances).toHaveBeenNthCalledWith(1, 'bot');
    expect(openclawService.searchInstances).toHaveBeenNthCalledWith(2, '');
  });

  it('forwards workspace message lookups', async () => {
    await expect(controller.getLastMessage('workspace-1')).resolves.toEqual({
      id: 'message-1',
    });
    await expect(
      controller.getLastMessages({
        workspace_ids: ['workspace-1', 'workspace-2'],
      }),
    ).resolves.toEqual([{ id: 'message-1' }]);

    expect(openclawService.getWorkspaceLastMessage).toHaveBeenCalledWith(
      'workspace-1',
    );
    expect(openclawService.getWorkspacesLastMessages).toHaveBeenCalledWith([
      'workspace-1',
      'workspace-2',
    ]);
  });

  it('forwards activity and conversation lookups', async () => {
    await expect(controller.getInstanceActivity()).resolves.toEqual(['active']);
    await expect(controller.getConversations('instance-1')).resolves.toEqual([
      { id: 'channel-1' },
    ]);

    expect(openclawService.getAllInstanceActivity).toHaveBeenCalled();
    expect(openclawService.getInstanceConversations).toHaveBeenCalledWith(
      'instance-1',
    );
  });

  it('caps conversation message limits at 100 and defaults invalid values to 50', async () => {
    await expect(
      controller.getConversationMessages(
        'instance-1',
        'channel-1',
        '200',
        'cursor-1',
      ),
    ).resolves.toEqual([{ id: 'message-1' }]);
    await expect(
      controller.getConversationMessages(
        'instance-1',
        'channel-1',
        '0',
        undefined,
      ),
    ).resolves.toEqual([{ id: 'message-1' }]);

    expect(openclawService.getConversationMessages).toHaveBeenNthCalledWith(
      1,
      'instance-1',
      'channel-1',
      100,
      'cursor-1',
    );
    expect(openclawService.getConversationMessages).toHaveBeenNthCalledWith(
      2,
      'instance-1',
      'channel-1',
      50,
      undefined,
    );
  });
});
