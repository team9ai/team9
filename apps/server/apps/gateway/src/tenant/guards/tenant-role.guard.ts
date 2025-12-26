import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const TENANT_ROLES_KEY = 'tenant_roles';
export const TenantRoles = (
  ...roles: ('owner' | 'admin' | 'member' | 'guest')[]
) => SetMetadata(TENANT_ROLES_KEY, roles);

@Injectable()
export class TenantRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      TENANT_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantRole = request.tenantRole;

    if (!tenantRole) {
      throw new ForbiddenException('Tenant role not determined');
    }

    // Role hierarchy: owner > admin > member > guest
    const roleHierarchy = {
      owner: 4,
      admin: 3,
      member: 2,
      guest: 1,
    };

    const userRoleLevel = roleHierarchy[tenantRole] || 0;
    const requiredRoleLevel = Math.min(
      ...requiredRoles.map((r) => roleHierarchy[r] || 0),
    );

    if (userRoleLevel < requiredRoleLevel) {
      throw new ForbiddenException('Insufficient tenant permissions');
    }

    return true;
  }
}
