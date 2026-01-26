import { Injectable, NestMiddleware, Logger, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  DATABASE_CONNECTION,
  eq,
  or,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';

type Tenant = typeof schema.tenants.$inferSelect;

// Cache TTL: 5 minutes
const TENANT_CACHE_TTL = 300;

/**
 * Middleware to extract tenant context from various sources and attach it to the request.
 * Supports: X-Tenant-Id header, ?tenant= query parameter, domain, and default tenant.
 * Uses Redis cache to avoid database queries on every request.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  async use(
    req: Request & { tenantId?: string; tenant?: Tenant },
    res: Response,
    next: NextFunction,
  ) {
    try {
      const tenantIdentifier = this.extractTenantIdentifier(req);

      if (tenantIdentifier) {
        const tenant = await this.resolveTenant(tenantIdentifier);

        if (tenant && tenant.isActive) {
          req.tenant = tenant;
          req.tenantId = tenant.id;
          this.logger.debug(`Tenant context set: ${tenant.slug}`);
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to resolve tenant context: ${error.message}`);
    }

    next();
  }

  /**
   * Resolve tenant with Redis cache using getOrSet
   */
  private async resolveTenant(identifier: string): Promise<Tenant | null> {
    const cacheKey = `tenant:${identifier}`;

    return this.redisService.getOrSet<Tenant>(
      cacheKey,
      () => this.findTenantByIdentifier(identifier),
      TENANT_CACHE_TTL,
    );
  }

  /**
   * Find tenant by ID, slug, or domain in a single query
   */
  private async findTenantByIdentifier(
    identifier: string,
  ): Promise<Tenant | null> {
    const conditions = [eq(schema.tenants.slug, identifier)];

    if (this.isUUID(identifier)) {
      conditions.push(eq(schema.tenants.id, identifier));
    }

    if (identifier.includes('.')) {
      conditions.push(eq(schema.tenants.domain, identifier));
    }

    const [tenant] = await this.db
      .select()
      .from(schema.tenants)
      .where(or(...conditions))
      .limit(1);

    return tenant || null;
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
