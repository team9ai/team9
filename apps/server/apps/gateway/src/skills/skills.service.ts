import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { TextDecoder } from 'node:util';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  inArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  SkillType,
  SkillVersionStatus,
  SkillFile,
  SkillVersion,
  SkillFileManifestEntry,
} from '@team9/database/schemas';
import { Folder9ClientService } from '../wikis/folder9-client.service.js';
import type {
  Folder9BlobResponse,
  Folder9CommitResponse,
  Folder9Permission,
  Folder9TreeEntry,
} from '../wikis/types/folder9.types.js';
import type { FolderCommitDto } from '../routines/dto/folder-commit.dto.js';
import type {
  CreateSkillDto,
  UpdateSkillDto,
  CreateVersionDto,
} from './dto/index.js';

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

  async create(dto: CreateSkillDto, userId: string, tenantId: string) {
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
        currentVersion: 0,
        creatorId: userId,
      })
      .returning();

    return skill;
  }

  async list(tenantId: string, type?: SkillType) {
    const conditions = [eq(schema.skills.tenantId, tenantId)];
    if (type) conditions.push(eq(schema.skills.type, type));

    const skills = await this.db
      .select()
      .from(schema.skills)
      .where(and(...conditions))
      .orderBy(desc(schema.skills.createdAt));

    if (skills.length === 0) return [];

    const skillIds = skills.map((s) => s.id);
    const suggestions = await this.db
      .select({ skillId: schema.skillVersions.skillId })
      .from(schema.skillVersions)
      .where(
        and(
          inArray(schema.skillVersions.skillId, skillIds),
          eq(schema.skillVersions.status, 'suggested'),
        ),
      );

    const countMap = new Map<string, number>();
    for (const s of suggestions) {
      countMap.set(s.skillId, (countMap.get(s.skillId) ?? 0) + 1);
    }

    return skills.map((s) => ({
      ...s,
      pendingSuggestionsCount: countMap.get(s.id) ?? 0,
    }));
  }

  async getById(skillId: string, tenantId: string) {
    const skill = await this.getSkillOrThrow(skillId, tenantId);

    let files: SkillFile[] = [];
    let currentVersionInfo: SkillVersion | null = null;

    if (skill.currentVersion > 0) {
      const [version] = await this.db
        .select()
        .from(schema.skillVersions)
        .where(
          and(
            eq(schema.skillVersions.skillId, skillId),
            eq(schema.skillVersions.version, skill.currentVersion),
          ),
        )
        .limit(1);

      if (version) {
        currentVersionInfo = version;
        const fileIds = version.fileManifest.map((f) => f.fileId);
        if (fileIds.length > 0) {
          files = await this.db
            .select()
            .from(schema.skillFiles)
            .where(inArray(schema.skillFiles.id, fileIds));
        }
      }
    }

    const suggestions = await this.db
      .select()
      .from(schema.skillVersions)
      .where(
        and(
          eq(schema.skillVersions.skillId, skillId),
          eq(schema.skillVersions.status, 'suggested'),
        ),
      );

    return {
      ...skill,
      currentVersionInfo,
      files,
      pendingSuggestions: suggestions,
    };
  }

  async update(skillId: string, dto: UpdateSkillDto, tenantId: string) {
    await this.getSkillOrThrow(skillId, tenantId);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.icon !== undefined) updateData.icon = dto.icon;

    const [updated] = await this.db
      .update(schema.skills)
      .set(updateData)
      .where(eq(schema.skills.id, skillId))
      .returning();

    return updated;
  }

  async delete(skillId: string, tenantId: string) {
    const skill = await this.getSkillOrThrow(skillId, tenantId);
    if (skill.folderId) {
      await this.folder9Client.deleteFolder(tenantId, skill.folderId);
    }
    await this.db.delete(schema.skills).where(eq(schema.skills.id, skillId));
    return { success: true };
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

  async listVersions(skillId: string, tenantId: string) {
    await this.getSkillOrThrow(skillId, tenantId);

    return this.db
      .select()
      .from(schema.skillVersions)
      .where(eq(schema.skillVersions.skillId, skillId))
      .orderBy(desc(schema.skillVersions.version));
  }

  async getVersion(skillId: string, version: number, tenantId: string) {
    await this.getSkillOrThrow(skillId, tenantId);

    const [versionRow] = await this.db
      .select()
      .from(schema.skillVersions)
      .where(
        and(
          eq(schema.skillVersions.skillId, skillId),
          eq(schema.skillVersions.version, version),
        ),
      )
      .limit(1);

    if (!versionRow) throw new NotFoundException('Version not found');

    const fileIds = versionRow.fileManifest.map((f) => f.fileId);
    let files: SkillFile[] = [];
    if (fileIds.length > 0) {
      files = await this.db
        .select()
        .from(schema.skillFiles)
        .where(inArray(schema.skillFiles.id, fileIds));
    }

    return { ...versionRow, files };
  }

  async createVersion(
    skillId: string,
    dto: CreateVersionDto,
    userId: string,
    tenantId: string,
  ) {
    const skill = await this.getSkillOrThrow(skillId, tenantId);
    const nextVersion = skill.currentVersion + 1;

    const version = await this.createVersionInternal(skillId, {
      message: dto.message,
      files: dto.files,
      status: dto.status,
      suggestedBy: dto.suggestedBy,
      version: nextVersion,
      creatorId: userId,
    });

    if (dto.status === 'published') {
      await this.db
        .update(schema.skills)
        .set({ currentVersion: nextVersion, updatedAt: new Date() })
        .where(eq(schema.skills.id, skillId));
    }

    return version;
  }

  async reviewVersion(
    skillId: string,
    version: number,
    action: 'approve' | 'reject',
    tenantId: string,
  ) {
    await this.getSkillOrThrow(skillId, tenantId);

    const [versionRow] = await this.db
      .select()
      .from(schema.skillVersions)
      .where(
        and(
          eq(schema.skillVersions.skillId, skillId),
          eq(schema.skillVersions.version, version),
        ),
      )
      .limit(1);

    if (!versionRow) throw new NotFoundException('Version not found');
    if (versionRow.status !== 'suggested') {
      throw new BadRequestException('Only suggested versions can be reviewed');
    }

    if (action === 'approve') {
      await this.db
        .update(schema.skillVersions)
        .set({ status: 'published' })
        .where(eq(schema.skillVersions.id, versionRow.id));

      await this.db
        .update(schema.skills)
        .set({ currentVersion: version, updatedAt: new Date() })
        .where(eq(schema.skills.id, skillId));
    } else {
      await this.db
        .update(schema.skillVersions)
        .set({ status: 'rejected' })
        .where(eq(schema.skillVersions.id, versionRow.id));
    }

    return { success: true };
  }

  private async createVersionInternal(
    skillId: string,
    opts: {
      message?: string;
      files: { path: string; content: string }[];
      status: SkillVersionStatus;
      suggestedBy?: string;
      version: number;
      creatorId: string;
    },
  ) {
    const fileManifest: SkillFileManifestEntry[] = [];
    for (const file of opts.files) {
      const fileId = uuidv7();
      await this.db.insert(schema.skillFiles).values({
        id: fileId,
        skillId,
        path: file.path,
        content: file.content,
        size: Buffer.byteLength(file.content, 'utf8'),
      });
      fileManifest.push({ path: file.path, fileId });
    }

    const versionId = uuidv7();
    const [version] = await this.db
      .insert(schema.skillVersions)
      .values({
        id: versionId,
        skillId,
        version: opts.version,
        message: opts.message ?? null,
        status: opts.status,
        fileManifest,
        suggestedBy: opts.suggestedBy ?? null,
        creatorId: opts.creatorId,
      })
      .returning();

    return version;
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
      const files = await this.getSkillFolderSeedFiles(skill);

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

  private async getSkillFolderSeedFiles(
    skill: schema.Skill,
  ): Promise<{ path: string; content: string }[]> {
    if (skill.currentVersion > 0) {
      const [version] = await this.db
        .select()
        .from(schema.skillVersions)
        .where(
          and(
            eq(schema.skillVersions.skillId, skill.id),
            eq(schema.skillVersions.version, skill.currentVersion),
          ),
        )
        .limit(1);

      if (version) {
        const fileIds = version.fileManifest.map((file) => file.fileId);
        if (fileIds.length > 0) {
          const files = await this.db
            .select()
            .from(schema.skillFiles)
            .where(inArray(schema.skillFiles.id, fileIds));
          const byId = new Map(files.map((file) => [file.id, file]));
          const restored = version.fileManifest
            .map((entry) => byId.get(entry.fileId))
            .filter((file): file is SkillFile => Boolean(file))
            .map((file) => ({ path: file.path, content: file.content }));
          if (restored.length > 0) {
            return this.ensureSkillMd(
              restored,
              skill.name,
              skill.description ?? undefined,
            );
          }
        }
      }
    }

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
