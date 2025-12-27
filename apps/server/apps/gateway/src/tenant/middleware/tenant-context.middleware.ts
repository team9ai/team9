import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantService, TenantResponse } from '../tenant.service.js';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);

  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantIdentifier = this.extractTenantIdentifier(req);

      if (tenantIdentifier) {
        let tenant: TenantResponse | null = null;

        // Try to find by ID first (UUID format)
        if (this.isUUID(tenantIdentifier)) {
          tenant = await this.tenantService.findById(tenantIdentifier);
        }

        // Try by slug
        if (!tenant) {
          tenant = await this.tenantService.findBySlug(tenantIdentifier);
        }

        // Try by domain
        if (!tenant) {
          tenant = await this.tenantService.findByDomain(tenantIdentifier);
        }

        if (tenant && tenant.isActive) {
          (req as any).tenant = tenant;
          (req as any).tenantId = tenant.id;
          this.logger.debug(`Tenant context set: ${tenant.slug}`);
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to resolve tenant context: ${error.message}`);
    }

    next();
  }

  private extractTenantIdentifier(req: Request): string | null {
    // Priority 1: X-Tenant-ID header
    const headerTenant = req.headers['x-tenant-id'] as string;
    if (headerTenant) {
      return headerTenant;
    }

    // Priority 2: Query parameter
    const queryTenant = req.query.tenant as string;
    if (queryTenant) {
      return queryTenant;
    }

    // Priority 3: Custom domain (for production)
    const host = req.headers.host;
    if (host && !this.isLocalhost(host)) {
      return host;
    }

    // Priority 4: Default tenant for development
    if (this.isLocalhost(host || '')) {
      return 'default';
    }

    return null;
  }

  private isUUID(str: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  private isLocalhost(host: string): boolean {
    return (
      host.includes('localhost') ||
      host.includes('127.0.0.1') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.')
    );
  }
}
