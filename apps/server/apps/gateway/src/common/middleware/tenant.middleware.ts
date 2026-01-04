import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to extract tenant ID from X-Tenant-Id header
 * and attach it to the request object for use in @CurrentTenantId() decorator
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request & { tenantId?: string }, res: Response, next: NextFunction) {
    const tenantId = req.headers['x-tenant-id'] as string | undefined;

    if (tenantId) {
      req.tenantId = tenantId;
    }

    next();
  }
}
