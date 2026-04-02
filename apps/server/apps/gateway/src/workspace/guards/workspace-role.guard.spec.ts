import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  WorkspaceRoleGuard,
  WorkspaceRoles,
  WORKSPACE_ROLES_KEY,
} from './workspace-role.guard.js';

function createContext(
  request: Record<string, unknown>,
  handler: () => void = () => undefined,
  targetClass: object = class TestClass {},
) {
  return {
    getHandler: () => handler,
    getClass: () => targetClass,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}

describe('WorkspaceRoleGuard', () => {
  let reflector: {
    getAllAndOverride: jest.Mock;
  };
  let guard: WorkspaceRoleGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    guard = new WorkspaceRoleGuard(reflector as never);
  });

  it('exports metadata through WorkspaceRoles', () => {
    class DemoController {
      @WorkspaceRoles('owner', 'admin')
      handler() {}
    }

    const metadata = Reflect.getMetadata(
      WORKSPACE_ROLES_KEY,
      DemoController.prototype.handler,
    );
    expect(metadata).toEqual(['owner', 'admin']);
  });

  it('allows access when no role metadata is defined', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(createContext({}))).toBe(true);
  });

  it('throws when the workspace role is missing from the request', () => {
    reflector.getAllAndOverride.mockReturnValue(['member']);

    expect(() => guard.canActivate(createContext({}))).toThrow(
      new ForbiddenException('Workspace role not determined'),
    );
  });

  it('throws when the user role is below the required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);

    expect(() =>
      guard.canActivate(createContext({ workspaceRole: 'member' })),
    ).toThrow(new ForbiddenException('Insufficient workspace permissions'));
  });

  it('accepts workspaceRole and tenantRole that satisfy the requirement', () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(['member'])
      .mockReturnValueOnce(['guest']);

    expect(guard.canActivate(createContext({ workspaceRole: 'admin' }))).toBe(
      true,
    );
    expect(guard.canActivate(createContext({ tenantRole: 'guest' }))).toBe(
      true,
    );
  });
});
