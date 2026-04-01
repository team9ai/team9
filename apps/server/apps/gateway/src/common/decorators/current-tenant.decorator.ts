import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface TenantRequest {
  tenant?: unknown;
  tenantId?: string;
}

/**
 * Community edition compatibility decorator.
 * In community edition, always returns undefined.
 * In enterprise edition, this decorator is provided by @team9/enterprise-tenant.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<TenantRequest>();
    return request.tenant;
  },
);

export const CurrentTenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<TenantRequest>();
    return request.tenantId;
  },
);
