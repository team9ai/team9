import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const WORKSPACE_ROLES_KEY = 'workspace_roles';
const WORKSPACE_ROLE_LEVELS = {
  owner: 4,
  admin: 3,
  member: 2,
  guest: 1,
} as const;

type WorkspaceRole = keyof typeof WORKSPACE_ROLE_LEVELS;

export const WorkspaceRoles = (...roles: WorkspaceRole[]) =>
  SetMetadata(WORKSPACE_ROLES_KEY, roles);

@Injectable()
export class WorkspaceRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<WorkspaceRole[]>(
      WORKSPACE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      workspaceRole?: WorkspaceRole;
      tenantRole?: WorkspaceRole;
    }>();
    const workspaceRole = request.workspaceRole || request.tenantRole;

    if (!workspaceRole) {
      throw new ForbiddenException('Workspace role not determined');
    }

    const userRoleLevel = WORKSPACE_ROLE_LEVELS[workspaceRole] || 0;
    const requiredRoleLevel = Math.min(
      ...requiredRoles.map((role) => WORKSPACE_ROLE_LEVELS[role] || 0),
    );

    if (userRoleLevel < requiredRoleLevel) {
      throw new ForbiddenException('Insufficient workspace permissions');
    }

    return true;
  }
}
