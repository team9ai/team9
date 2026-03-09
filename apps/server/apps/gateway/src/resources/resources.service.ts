import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  ResourceType,
  ResourceAuthorization,
} from '@team9/database/schemas';
import type { CreateResourceDto } from './dto/create-resource.dto.js';
import type { UpdateResourceDto } from './dto/update-resource.dto.js';
import type { AuthorizeResourceDto } from './dto/authorize-resource.dto.js';
import type { RevokeResourceDto } from './dto/authorize-resource.dto.js';

export interface ResourceListFilters {
  type?: ResourceType;
}

@Injectable()
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────

  async create(dto: CreateResourceDto, userId: string, tenantId: string) {
    const [resource] = await this.db
      .insert(schema.resources)
      .values({
        id: uuidv7(),
        tenantId,
        type: dto.type,
        name: dto.name,
        description: dto.description ?? null,
        config: dto.config as unknown as schema.ResourceConfig,
        status: 'configuring',
        creatorId: userId,
      })
      .returning();

    return resource;
  }

  async list(tenantId: string, filters?: ResourceListFilters) {
    const conditions = [eq(schema.resources.tenantId, tenantId)];

    if (filters?.type) {
      conditions.push(eq(schema.resources.type, filters.type));
    }

    return this.db
      .select()
      .from(schema.resources)
      .where(and(...conditions))
      .orderBy(desc(schema.resources.createdAt));
  }

  async getById(id: string, tenantId: string) {
    return this.getResourceOrThrow(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateResourceDto,
    userId: string,
    tenantId: string,
  ) {
    const resource = await this.getResourceOrThrow(id, tenantId);
    this.assertCreatorOwnership(resource, userId);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.config !== undefined) updateData.config = dto.config;
    if (dto.status !== undefined) updateData.status = dto.status;

    const [updated] = await this.db
      .update(schema.resources)
      .set(updateData)
      .where(eq(schema.resources.id, id))
      .returning();

    return updated;
  }

  async delete(id: string, userId: string, tenantId: string) {
    const resource = await this.getResourceOrThrow(id, tenantId);
    this.assertCreatorOwnership(resource, userId);

    await this.db.delete(schema.resources).where(eq(schema.resources.id, id));

    return { success: true };
  }

  // ── Authorization ──────────────────────────────────────────────

  async authorize(
    id: string,
    dto: AuthorizeResourceDto,
    userId: string,
    tenantId: string,
  ) {
    const resource = await this.getResourceOrThrow(id, tenantId);

    const authorizations = [...(resource.authorizations ?? [])];

    const exists = authorizations.some(
      (a) => a.granteeType === dto.granteeType && a.granteeId === dto.granteeId,
    );
    if (exists) {
      throw new BadRequestException('Authorization already exists');
    }

    const newAuth: ResourceAuthorization = {
      granteeType: dto.granteeType,
      granteeId: dto.granteeId,
      permissions: dto.permissions ?? { level: 'full' },
      grantedBy: userId,
      grantedAt: new Date().toISOString(),
    };
    authorizations.push(newAuth);

    const [updated] = await this.db
      .update(schema.resources)
      .set({ authorizations, updatedAt: new Date() })
      .where(eq(schema.resources.id, id))
      .returning();

    return updated;
  }

  async revoke(
    id: string,
    dto: RevokeResourceDto,
    userId: string,
    tenantId: string,
  ) {
    const resource = await this.getResourceOrThrow(id, tenantId);

    const authorizations = (resource.authorizations ?? []).filter(
      (a) =>
        !(a.granteeType === dto.granteeType && a.granteeId === dto.granteeId),
    );

    const [updated] = await this.db
      .update(schema.resources)
      .set({ authorizations, updatedAt: new Date() })
      .where(eq(schema.resources.id, id))
      .returning();

    return updated;
  }

  // ── Usage Logs ─────────────────────────────────────────────────

  async getUsageLogs(id: string, tenantId: string, limit = 50, offset = 0) {
    await this.getResourceOrThrow(id, tenantId);

    return this.db
      .select()
      .from(schema.resourceUsageLogs)
      .where(eq(schema.resourceUsageLogs.resourceId, id))
      .orderBy(desc(schema.resourceUsageLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async createUsageLog(
    id: string,
    data: {
      actorType: 'agent' | 'user';
      actorId: string;
      action: string;
      taskId?: string;
      executionId?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const [log] = await this.db
      .insert(schema.resourceUsageLogs)
      .values({
        id: uuidv7(),
        resourceId: id,
        actorType: data.actorType,
        actorId: data.actorId,
        action: data.action,
        taskId: data.taskId ?? null,
        executionId: data.executionId ?? null,
        metadata: data.metadata ?? null,
      })
      .returning();

    return log;
  }

  // ── Heartbeat ──────────────────────────────────────────────────

  async heartbeat(id: string) {
    const [updated] = await this.db
      .update(schema.resources)
      .set({
        lastHeartbeatAt: new Date(),
        status: 'online',
        updatedAt: new Date(),
      })
      .where(eq(schema.resources.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException('Resource not found');
    }

    return { success: true };
  }

  // ── Internal helpers ──────────────────────────────────────────

  private async getResourceOrThrow(
    id: string,
    tenantId: string,
  ): Promise<schema.Resource> {
    const [resource] = await this.db
      .select()
      .from(schema.resources)
      .where(
        and(
          eq(schema.resources.id, id),
          eq(schema.resources.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!resource) {
      throw new NotFoundException('Resource not found');
    }

    return resource;
  }

  private assertCreatorOwnership(
    resource: schema.Resource,
    userId: string,
  ): void {
    if (resource.creatorId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }
  }
}
