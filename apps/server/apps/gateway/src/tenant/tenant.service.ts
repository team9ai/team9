import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';

export interface TenantResponse {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logoUrl: string | null;
  plan: 'free' | 'pro' | 'enterprise';
  settings: schema.TenantSettings;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantMemberResponse {
  id: string;
  tenantId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  joinedAt: Date;
  user?: {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(data: {
    name: string;
    slug: string;
    domain?: string;
    plan?: 'free' | 'pro' | 'enterprise';
    ownerId: string;
  }): Promise<TenantResponse> {
    // Check if slug already exists
    const existingSlug = await this.findBySlug(data.slug);
    if (existingSlug) {
      throw new ConflictException('Tenant slug already exists');
    }

    // Check if domain already exists
    if (data.domain) {
      const existingDomain = await this.findByDomain(data.domain);
      if (existingDomain) {
        throw new ConflictException('Domain already in use');
      }
    }

    const [tenant] = await this.db
      .insert(schema.tenants)
      .values({
        name: data.name,
        slug: data.slug,
        domain: data.domain,
        plan: data.plan || 'free',
      })
      .returning();

    // Add owner as member
    await this.addMember(tenant.id, data.ownerId, 'owner');

    this.logger.log(`Created tenant: ${tenant.name} (${tenant.slug})`);

    return tenant as TenantResponse;
  }

  async findById(id: string): Promise<TenantResponse | null> {
    const [tenant] = await this.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, id))
      .limit(1);

    return (tenant as TenantResponse) || null;
  }

  async findByIdOrThrow(id: string): Promise<TenantResponse> {
    const tenant = await this.findById(id);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  async findBySlug(slug: string): Promise<TenantResponse | null> {
    const [tenant] = await this.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
      .limit(1);

    return (tenant as TenantResponse) || null;
  }

  async findByDomain(domain: string): Promise<TenantResponse | null> {
    const [tenant] = await this.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.domain, domain))
      .limit(1);

    return (tenant as TenantResponse) || null;
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      slug: string;
      domain: string;
      logoUrl: string;
      plan: 'free' | 'pro' | 'enterprise';
      settings: schema.TenantSettings;
      isActive: boolean;
    }>,
  ): Promise<TenantResponse> {
    const [tenant] = await this.db
      .update(schema.tenants)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.tenants.id, id))
      .returning();

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant as TenantResponse;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schema.tenants).where(eq(schema.tenants.id, id));
  }

  // Member management
  async addMember(
    tenantId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' | 'guest' = 'member',
    invitedBy?: string,
  ): Promise<void> {
    // Check if already a member
    const existing = await this.getMember(tenantId, userId);
    if (existing) {
      throw new ConflictException('User is already a member of this tenant');
    }

    await this.db.insert(schema.tenantMembers).values({
      tenantId,
      userId,
      role,
      invitedBy,
    });

    this.logger.log(`Added user ${userId} to tenant ${tenantId} as ${role}`);
  }

  async removeMember(tenantId: string, userId: string): Promise<void> {
    await this.db
      .delete(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, tenantId),
          eq(schema.tenantMembers.userId, userId),
        ),
      );
  }

  async getMember(
    tenantId: string,
    userId: string,
  ): Promise<TenantMemberResponse | null> {
    const [member] = await this.db
      .select()
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, tenantId),
          eq(schema.tenantMembers.userId, userId),
        ),
      )
      .limit(1);

    return (member as TenantMemberResponse) || null;
  }

  async getMemberRole(
    tenantId: string,
    userId: string,
  ): Promise<'owner' | 'admin' | 'member' | 'guest' | null> {
    const member = await this.getMember(tenantId, userId);
    return member?.role || null;
  }

  async isMember(tenantId: string, userId: string): Promise<boolean> {
    const member = await this.getMember(tenantId, userId);
    return member !== null;
  }

  async getMembers(tenantId: string): Promise<TenantMemberResponse[]> {
    const result = await this.db
      .select({
        id: schema.tenantMembers.id,
        tenantId: schema.tenantMembers.tenantId,
        userId: schema.tenantMembers.userId,
        role: schema.tenantMembers.role,
        joinedAt: schema.tenantMembers.joinedAt,
        user: {
          id: schema.users.id,
          email: schema.users.email,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
        },
      })
      .from(schema.tenantMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.tenantMembers.userId))
      .where(eq(schema.tenantMembers.tenantId, tenantId));

    return result as TenantMemberResponse[];
  }

  async getUserTenants(userId: string): Promise<TenantResponse[]> {
    const result = await this.db
      .select({
        id: schema.tenants.id,
        name: schema.tenants.name,
        slug: schema.tenants.slug,
        domain: schema.tenants.domain,
        logoUrl: schema.tenants.logoUrl,
        plan: schema.tenants.plan,
        settings: schema.tenants.settings,
        isActive: schema.tenants.isActive,
        createdAt: schema.tenants.createdAt,
        updatedAt: schema.tenants.updatedAt,
      })
      .from(schema.tenantMembers)
      .innerJoin(
        schema.tenants,
        eq(schema.tenants.id, schema.tenantMembers.tenantId),
      )
      .where(eq(schema.tenantMembers.userId, userId));

    return result as TenantResponse[];
  }

  async updateMemberRole(
    tenantId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' | 'guest',
  ): Promise<void> {
    await this.db
      .update(schema.tenantMembers)
      .set({ role })
      .where(
        and(
          eq(schema.tenantMembers.tenantId, tenantId),
          eq(schema.tenantMembers.userId, userId),
        ),
      );
  }

  // Get or create default tenant
  async getOrCreateDefaultTenant(ownerId: string): Promise<TenantResponse> {
    const defaultSlug = 'default';
    let tenant = await this.findBySlug(defaultSlug);

    if (!tenant) {
      tenant = await this.create({
        name: 'Default Workspace',
        slug: defaultSlug,
        ownerId,
      });
    } else {
      // Ensure user is a member
      const isMember = await this.isMember(tenant.id, ownerId);
      if (!isMember) {
        await this.addMember(tenant.id, ownerId, 'member');
      }
    }

    return tenant;
  }
}
