import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Community edition compatibility decorator.
 * In community edition, always returns undefined.
 * In enterprise edition, this decorator is provided by @team9/enterprise-tenant.
 */
export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenant;
  },
);

export const CurrentTenantId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenantId;
  },
);
