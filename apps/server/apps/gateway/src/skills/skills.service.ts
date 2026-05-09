import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { TextDecoder } from 'node:util';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  ne,
  ilike,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { SkillType, SkillAgentAccess } from '@team9/database/schemas';
import { Folder9ClientService } from '../wikis/folder9-client.service.js';
import type {
  Folder9BlobResponse,
  Folder9CommitResponse,
  Folder9Permission,
  Folder9TreeEntry,
} from '../wikis/types/folder9.types.js';
import type { FolderCommitDto } from '../routines/dto/folder-commit.dto.js';
import type { CreateSkillDto, UpdateSkillDto } from './dto/index.js';

@Injectable()
export class SkillsService {
  private static readonly READ_TOKEN_TTL_MS = 5 * 60_000;
  private static readonly WRITE_TOKEN_TTL_MS = 15 * 60_000;
  private readonly provisioningBySkill = new Map<string, Promise<string>>();

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly folder9Client: Folder9ClientService,
  ) {}

  async create(
    dto: CreateSkillDto,
    userId: string,
    tenantId: string,
    defaults: { agentAccess: SkillAgentAccess } = { agentAccess: 'read' },
  ) {
    const skillId = uuidv7();
    const files = this.ensureSkillMd(dto.files, dto.name, dto.description);

    const folder = await this.folder9Client.createFolder(tenantId, {
      name: dto.name,
      type: 'light',
      owner_type: 'workspace',
      owner_id: tenantId,
      approval_mode: 'auto',
      metadata: { team9_kind: 'skill', team9_skill_id: skillId },
    });

    const token = await this.mintSkillFolderToken(
      folder.id,
      userId,
      'write',
      SkillsService.WRITE_TOKEN_TTL_MS,
    );

    await this.folder9Client.commit(tenantId, folder.id, token, {
      message: 'Initialize skill',
      files: files.map((file) => ({
        path: file.path,
        content: file.content,
        action: 'create' as const,
      })),
    });

    const [skill] = await this.db
      .insert(schema.skills)
      .values({
        id: skillId,
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type ?? 'general',
        icon: dto.icon ?? null,
        folderId: folder.id,
        agentAccess: dto.agentAccess ?? defaults.agentAccess,
        creatorId: userId,
      })
      .returning();

    return skill;
  }

  async list(tenantId: string, type?: SkillType) {
    const conditions = [eq(schema.skills.tenantId, tenantId)];
    if (type) conditions.push(eq(schema.skills.type, type));
    return this.db
      .select()
      .from(schema.skills)
      .where(and(...conditions))
      .orderBy(desc(schema.skills.createdAt));
  }

  async getById(skillId: string, tenantId: string) {
    return this.getSkillOrThrow(skillId, tenantId);
  }

  async update(skillId: string, dto: UpdateSkillDto, tenantId: string) {
    await this.getSkillOrThrow(skillId, tenantId);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.icon !== undefined) updateData.icon = dto.icon;
    if (dto.agentAccess !== undefined) updateData.agentAccess = dto.agentAccess;

    const [updated] = await this.db
      .update(schema.skills)
      .set(updateData)
      .where(eq(schema.skills.id, skillId))
      .returning();

    return updated;
  }

  async delete(skillId: string, tenantId: string) {
    const skill = await this.getSkillOrThrow(skillId, tenantId);
    await this.db.delete(schema.skills).where(eq(schema.skills.id, skillId));
    if (skill.folderId) {
      await this.folder9Client
        .deleteFolder(tenantId, skill.folderId)
        .catch((err) => {
          // Best-effort: DB row is already gone; folder9 folder will be orphaned
          // until manual cleanup. Log so ops can spot it.
          console.warn(
            `[SkillsService] folder9 deleteFolder failed after DB row removed for skill ${skillId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }
    return { success: true };
  }

  async listForAgent(
    tenantId: string,
    filters: { type?: SkillType; name?: string } = {},
  ) {
    const conditions = [
      eq(schema.skills.tenantId, tenantId),
      ne(schema.skills.agentAccess, 'none'),
    ];
    if (filters.type) conditions.push(eq(schema.skills.type, filters.type));
    if (filters.name) {
      conditions.push(ilike(schema.skills.name, `%${filters.name}%`));
    }
    return this.db
      .select()
      .from(schema.skills)
      .where(and(...conditions))
      .orderBy(desc(schema.skills.createdAt));
  }

  async getByIdForAgent(skillId: string, tenantId: string) {
    const skill = await this.getSkillOrThrow(skillId, tenantId);
    if (skill.agentAccess === 'none') {
      throw new ForbiddenException('Skill is hidden from agents');
    }
    return skill;
  }

  async getFolderBlobForAgent(
    skillId: string,
    userId: string,
    tenantId: string,
    path: string,
  ): Promise<Folder9BlobResponse> {
    const skill = await this.getSkillOrThrow(skillId, tenantId);
    if (skill.agentAccess === 'none') {
      throw new ForbiddenException('Skill is hidden from agents');
    }
    if (!path || typeof path !== 'string' || path.trim().length === 0) {
      throw new BadRequestException('path query parameter is required');
    }
    return this.getSkillFolderBlobInternal(skill, userId, tenantId, path);
  }

  async getSkillFolderTree(
    skillId: string,
    userId: string,
    tenantId: string,
    opts: { path?: string; recursive?: boolean } = {},
  ): Promise<Folder9TreeEntry[]> {
    const skill = await this.getSkillOrThrow(skillId, tenantId);
    const folderId = await this.ensureSkillFolder(skill, userId, tenantId);
    const token = await this.mintSkillFolderToken(
      folderId,
      userId,
      'read',
      SkillsService.READ_TOKEN_TTL_MS,
    );
    return this.folder9Client.getTree(tenantId, folderId, token, opts);
  }

  async getSkillFolderBlob(
    skillId: string,
    userId: string,
    tenantId: string,
    path: string,
  ): Promise<Folder9BlobResponse> {
    if (!path || typeof path !== 'string' || path.trim().length === 0) {
      throw new BadRequestException('path query parameter is required');
    }
    const skill = await this.getSkillOrThrow(skillId, tenantId);
    return this.getSkillFolderBlobInternal(skill, userId, tenantId, path);
  }

  async commitSkillFolder(
    skillId: string,
    userId: string,
    tenantId: string,
    dto: FolderCommitDto,
  ): Promise<Folder9CommitResponse> {
    const skill = await this.getSkillOrThrow(skillId, tenantId);
    const folderId = await this.ensureSkillFolder(skill, userId, tenantId);
    const token = await this.mintSkillFolderToken(
      folderId,
      userId,
      'write',
      SkillsService.WRITE_TOKEN_TTL_MS,
    );
    return this.folder9Client.commit(tenantId, folderId, token, {
      message: dto.message,
      files: dto.files,
      propose: false,
    });
  }

  private async getSkillFolderBlobInternal(
    skill: schema.Skill,
    userId: string,
    tenantId: string,
    path: string,
  ): Promise<Folder9BlobResponse> {
    const folderId = await this.ensureSkillFolder(skill, userId, tenantId);
    const token = await this.mintSkillFolderToken(
      folderId,
      userId,
      'read',
      SkillsService.READ_TOKEN_TTL_MS,
    );
    const raw = await this.folder9Client.getRaw(
      tenantId,
      folderId,
      token,
      path,
    );
    return this.toBlobResponse(path, raw);
  }

  private ensureSkillMd(
    inputFiles: { path: string; content: string }[] | undefined,
    name: string,
    description: string | undefined,
  ): { path: string; content: string }[] {
    const files = [...(inputFiles ?? [])];
    const hasSkillMd = files.some(
      (file) => file.path.toLowerCase() === 'skill.md',
    );
    if (hasSkillMd) return files;

    const content = description?.trim()
      ? `# ${name}\n\n${description.trim()}\n`
      : `# ${name}\n\nDescribe when and how to use this skill.\n`;
    return [{ path: 'skill.md', content }, ...files];
  }

  private async mintSkillFolderToken(
    folderId: string,
    userId: string,
    permission: Folder9Permission,
    ttlMs: number,
  ): Promise<string> {
    const minted = await this.folder9Client.createToken({
      folder_id: folderId,
      permission,
      name: `skill-${permission}`,
      created_by: `user:${userId}`,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    });
    return minted.token;
  }

  private async ensureSkillFolder(
    skill: schema.Skill,
    userId: string,
    tenantId: string,
  ): Promise<string> {
    if (skill.folderId) return skill.folderId;

    const key = `${tenantId}:${skill.id}`;
    const existing = this.provisioningBySkill.get(key);
    if (existing) return existing;

    const provisioning = this.provisionSkillFolder(skill, userId, tenantId);
    this.provisioningBySkill.set(key, provisioning);
    try {
      return await provisioning;
    } finally {
      this.provisioningBySkill.delete(key);
    }
  }

  private async provisionSkillFolder(
    skill: schema.Skill,
    userId: string,
    tenantId: string,
  ): Promise<string> {
    const folder = await this.folder9Client.createFolder(tenantId, {
      name: skill.name,
      type: 'light',
      owner_type: 'workspace',
      owner_id: tenantId,
      approval_mode: 'auto',
      metadata: { team9_kind: 'skill', team9_skill_id: skill.id },
    });

    try {
      const token = await this.mintSkillFolderToken(
        folder.id,
        userId,
        'write',
        SkillsService.WRITE_TOKEN_TTL_MS,
      );
      const files = this.getSkillFolderSeedFiles(skill);

      await this.folder9Client.commit(tenantId, folder.id, token, {
        message: 'Initialize skill folder',
        files: files.map((file) => ({
          path: file.path,
          content: file.content,
          action: 'create' as const,
        })),
      });

      await this.db
        .update(schema.skills)
        .set({ folderId: folder.id, updatedAt: new Date() })
        .where(
          and(
            eq(schema.skills.id, skill.id),
            eq(schema.skills.tenantId, tenantId),
          ),
        );
    } catch (error) {
      await this.folder9Client.deleteFolder(tenantId, folder.id).catch(() => {
        // Best-effort cleanup; preserve the original provisioning error.
      });
      throw error;
    }

    return folder.id;
  }

  private toBlobResponse(path: string, raw: ArrayBuffer): Folder9BlobResponse {
    const bytes = Buffer.from(raw);
    try {
      return {
        path,
        size: bytes.length,
        content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        encoding: 'text',
      };
    } catch {
      return {
        path,
        size: bytes.length,
        content: bytes.toString('base64'),
        encoding: 'base64',
      };
    }
  }

  private getSkillFolderSeedFiles(
    skill: schema.Skill,
  ): { path: string; content: string }[] {
    return this.ensureSkillMd(
      undefined,
      skill.name,
      skill.description ?? undefined,
    );
  }

  private async getSkillOrThrow(id: string, tenantId?: string) {
    const conditions = [eq(schema.skills.id, id)];
    if (tenantId) conditions.push(eq(schema.skills.tenantId, tenantId));

    const [skill] = await this.db
      .select()
      .from(schema.skills)
      .where(and(...conditions))
      .limit(1);

    if (!skill) throw new NotFoundException('Skill not found');
    return skill;
  }
}
