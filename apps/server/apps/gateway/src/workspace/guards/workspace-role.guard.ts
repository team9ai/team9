import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const WORKSPACE_ROLES_KEY = 'workspace_roles';
export const WorkspaceRoles = (
  ...roles: ('owner' | 'admin' | 'member' | 'guest')[]
) => SetMetadata(WORKSPACE_ROLES_KEY, roles);

@Injectable()
export class WorkspaceRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      WORKSPACE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const workspaceRole = request.workspaceRole || request.tenantRole;

    if (!workspaceRole) {
      throw new ForbiddenException('Workspace role not determined');
    }

    // Role hierarchy: owner > admin > member > guest
    const roleHierarchy = {
      owner: 4,
      admin: 3,
      member: 2,
      guest: 1,
    };

    const userRoleLevel = roleHierarchy[workspaceRole] || 0;
    const requiredRoleLevel = Math.min(
      ...requiredRoles.map((r) => roleHierarchy[r] || 0),
    );

    if (userRoleLevel < requiredRoleLevel) {
      throw new ForbiddenException('Insufficient workspace permissions');
    }

    return true;
  }
}
