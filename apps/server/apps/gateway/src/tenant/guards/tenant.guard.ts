import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { TenantService } from '../tenant.service.js';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenantService: TenantService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tenantId = request.tenantId;
    const user = request.user;

    if (!tenantId) {
      throw new ForbiddenException('Tenant context required');
    }

    if (!user) {
      // Auth guard should handle this
      return true;
    }

    // Verify user is a member of the tenant
    const isMember = await this.tenantService.isMember(tenantId, user.sub);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this tenant');
    }

    // Attach tenant role to request
    const role = await this.tenantService.getMemberRole(tenantId, user.sub);
    request.tenantRole = role;

    return true;
  }
}
