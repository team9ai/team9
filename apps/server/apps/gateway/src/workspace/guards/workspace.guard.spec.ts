import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { WorkspaceGuard } from './workspace.guard.js';

function createContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}

describe('WorkspaceGuard', () => {
  let workspaceService: {
    isWorkspaceMember: jest.Mock;
    getMemberRole: jest.Mock;
  };
  let guard: WorkspaceGuard;

  beforeEach(() => {
    workspaceService = {
      isWorkspaceMember: jest.fn(),
      getMemberRole: jest.fn(),
    };
    guard = new WorkspaceGuard(workspaceService as never);
  });

  it('throws when no workspace context is present', async () => {
    await expect(
      guard.canActivate(
        createContext({
          params: {},
          user: { sub: 'user-1' },
        }),
      ),
    ).rejects.toThrow(new ForbiddenException('Workspace context required'));
  });

  it('allows unauthenticated requests to continue for the auth guard', async () => {
    await expect(
      guard.canActivate(
        createContext({
          params: { workspaceId: 'workspace-1' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('throws when the user is not a workspace member', async () => {
    workspaceService.isWorkspaceMember.mockResolvedValue(false);

    await expect(
      guard.canActivate(
        createContext({
          params: { workspaceId: 'workspace-1' },
          user: { sub: 'user-1' },
        }),
      ),
    ).rejects.toThrow(new ForbiddenException('Not a member of this workspace'));
  });

  it('attaches workspace roles when membership is valid', async () => {
    const request = {
      params: { id: 'workspace-legacy-id' },
      user: { sub: 'user-1' },
    };
    workspaceService.isWorkspaceMember.mockResolvedValue(true);
    workspaceService.getMemberRole.mockResolvedValue('admin');

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(workspaceService.isWorkspaceMember).toHaveBeenCalledWith(
      'workspace-legacy-id',
      'user-1',
    );
    expect(workspaceService.getMemberRole).toHaveBeenCalledWith(
      'workspace-legacy-id',
      'user-1',
    );
    expect((request as any).workspaceRole).toBe('admin');
    expect((request as any).tenantRole).toBe('admin');
  });

  it('uses tenantId when route params do not contain a workspace id', async () => {
    workspaceService.isWorkspaceMember.mockResolvedValue(true);
    workspaceService.getMemberRole.mockResolvedValue('member');

    await expect(
      guard.canActivate(
        createContext({
          params: {},
          tenantId: 'tenant-1',
          user: { sub: 'user-1' },
        }),
      ),
    ).resolves.toBe(true);

    expect(workspaceService.isWorkspaceMember).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
    );
  });
});
