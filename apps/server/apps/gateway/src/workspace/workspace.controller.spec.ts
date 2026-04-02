import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  InvitationsController,
  WorkspaceController,
} from './workspace.controller.js';

function createWorkspaceServiceMock() {
  return {
    create: jest.fn<any>(),
    getUserWorkspaces: jest.fn<any>(),
    findByIdOrThrow: jest.fn<any>(),
    update: jest.fn<any>(),
    delete: jest.fn<any>(),
    getWorkspaceMembers: jest.fn<any>(),
    addMember: jest.fn<any>(),
    updateMemberRole: jest.fn<any>(),
    removeMember: jest.fn<any>(),
    getOnlineOfflineMemberIds: jest.fn<any>(),
    createInvitation: jest.fn<any>(),
    getInvitations: jest.fn<any>(),
    revokeInvitation: jest.fn<any>(),
    getInvitationInfo: jest.fn<any>(),
    acceptInvitation: jest.fn<any>(),
  };
}

describe('WorkspaceController', () => {
  let controller: WorkspaceController;
  let invitationsController: InvitationsController;
  let workspaceService: ReturnType<typeof createWorkspaceServiceMock>;

  beforeEach(() => {
    workspaceService = createWorkspaceServiceMock();
    controller = new WorkspaceController(workspaceService as never);
    invitationsController = new InvitationsController(
      workspaceService as never,
    );
    jest
      .spyOn((controller as any).logger, 'log')
      .mockImplementation(() => undefined);
  });

  it('creates workspaces with the current user as owner', async () => {
    const dto = { name: 'Alpha' };
    const created = { id: 'workspace-1' };
    workspaceService.create.mockResolvedValue(created);

    await expect(controller.create(dto as never, 'user-1')).resolves.toEqual(
      created,
    );

    expect(workspaceService.create).toHaveBeenCalledWith({
      ...dto,
      ownerId: 'user-1',
    });
  });

  it('delegates workspace CRUD endpoints', async () => {
    workspaceService.getUserWorkspaces.mockResolvedValue([
      { id: 'workspace-1' },
    ]);
    workspaceService.findByIdOrThrow.mockResolvedValue({ id: 'workspace-1' });
    workspaceService.update.mockResolvedValue({
      id: 'workspace-1',
      name: 'Beta',
    });
    workspaceService.delete.mockResolvedValue(undefined);

    await expect(controller.getUserWorkspaces('user-1')).resolves.toEqual([
      { id: 'workspace-1' },
    ]);
    await expect(controller.findById('workspace-1')).resolves.toEqual({
      id: 'workspace-1',
    });
    await expect(
      controller.update('workspace-1', { name: 'Beta' } as never),
    ).resolves.toEqual({ id: 'workspace-1', name: 'Beta' });
    await expect(controller.delete('workspace-1')).resolves.toEqual({
      success: true,
    });

    expect(workspaceService.getUserWorkspaces).toHaveBeenCalledWith('user-1');
    expect(workspaceService.findByIdOrThrow).toHaveBeenCalledWith(
      'workspace-1',
    );
    expect(workspaceService.update).toHaveBeenCalledWith('workspace-1', {
      name: 'Beta',
    });
    expect(workspaceService.delete).toHaveBeenCalledWith('workspace-1');
  });

  it('delegates member management endpoints', async () => {
    workspaceService.getWorkspaceMembers.mockResolvedValue([{ id: 'user-2' }]);
    workspaceService.addMember.mockResolvedValue(undefined);
    workspaceService.updateMemberRole.mockResolvedValue(undefined);
    workspaceService.removeMember.mockResolvedValue(undefined);
    workspaceService.getOnlineOfflineMemberIds.mockResolvedValue({
      onlineMemberIds: ['user-1'],
      offlineMemberIds: ['user-2'],
    });

    await expect(
      controller.getWorkspaceMembers('workspace-1', 'user-1', {
        page: 2,
        limit: 30,
        search: 'ali',
      } as never),
    ).resolves.toEqual([{ id: 'user-2' }]);

    await expect(
      controller.addMember(
        'workspace-1',
        { userId: 'user-2', role: 'member' } as never,
        'user-1',
      ),
    ).resolves.toEqual({ success: true });

    await expect(
      controller.updateMemberRole('workspace-1', 'user-2', {
        role: 'admin',
      } as never),
    ).resolves.toEqual({ success: true });

    await expect(
      controller.removeMember('workspace-1', 'user-2'),
    ).resolves.toEqual({ success: true });

    await expect(
      controller.debugOnlineStatus('workspace-1', 'user-1'),
    ).resolves.toEqual({
      onlineMemberIds: ['user-1'],
      offlineMemberIds: ['user-2'],
    });

    expect(workspaceService.getWorkspaceMembers).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      { page: 2, limit: 30, search: 'ali' },
    );
    expect(workspaceService.addMember).toHaveBeenCalledWith(
      'workspace-1',
      'user-2',
      'member',
      'user-1',
    );
    expect(workspaceService.updateMemberRole).toHaveBeenCalledWith(
      'workspace-1',
      'user-2',
      'admin',
    );
    expect(workspaceService.removeMember).toHaveBeenCalledWith(
      'workspace-1',
      'user-2',
    );
    expect(workspaceService.getOnlineOfflineMemberIds).toHaveBeenCalledWith(
      'workspace-1',
    );
  });

  it('delegates invitation management endpoints', async () => {
    workspaceService.createInvitation.mockResolvedValue({ code: 'abc' });
    workspaceService.getInvitations.mockResolvedValue([{ code: 'abc' }]);
    workspaceService.revokeInvitation.mockResolvedValue(undefined);
    workspaceService.getInvitationInfo.mockResolvedValue({ code: 'abc' });
    workspaceService.acceptInvitation.mockResolvedValue({ success: true });

    await expect(
      controller.createInvitation('workspace-1', 'user-1', {
        role: 'member',
      } as never),
    ).resolves.toEqual({ code: 'abc' });
    await expect(controller.getInvitations('workspace-1')).resolves.toEqual([
      { code: 'abc' },
    ]);
    await expect(
      controller.revokeInvitation('workspace-1', 'abc'),
    ).resolves.toEqual({
      message: 'Invitation revoked successfully',
    });
    await expect(
      invitationsController.getInvitationInfo('abc'),
    ).resolves.toEqual({
      code: 'abc',
    });
    await expect(
      invitationsController.acceptInvitation('abc', 'user-2'),
    ).resolves.toEqual({ success: true });

    expect(workspaceService.createInvitation).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      { role: 'member' },
    );
    expect(workspaceService.getInvitations).toHaveBeenCalledWith('workspace-1');
    expect(workspaceService.revokeInvitation).toHaveBeenCalledWith(
      'workspace-1',
      'abc',
    );
    expect(workspaceService.getInvitationInfo).toHaveBeenCalledWith('abc');
    expect(workspaceService.acceptInvitation).toHaveBeenCalledWith(
      'abc',
      'user-2',
    );
  });
});
