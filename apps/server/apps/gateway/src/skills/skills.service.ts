import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
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
  SkillType,
  SkillVersionStatus,
  SkillFile,
  SkillVersion,
  SkillFileManifestEntry,
} from '@team9/database/schemas';
import type {
  CreateSkillDto,
  UpdateSkillDto,
  CreateVersionDto,
} from './dto/index.js';

@Injectable()
export class SkillsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(dto: CreateSkillDto, userId: string, tenantId: string) {
    const skillId = uuidv7();
    const files = dto.files ?? [];

    const [skill] = await this.db
      .insert(schema.skills)
      .values({
        id: skillId,
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type,
        icon: dto.icon ?? null,
        currentVersion: files.length > 0 ? 1 : 0,
        creatorId: userId,
      })
      .returning();

    if (files.length > 0) {
      await this.createVersionInternal(skillId, {
        message: 'Initial version',
        files,
        status: 'published',
        version: 1,
        creatorId: userId,
      });
    }

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
          const allFiles = await this.db
            .select()
            .from(schema.skillFiles)
            .where(eq(schema.skillFiles.skillId, skillId));
          files = allFiles.filter((f) => fileIds.includes(f.id));
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
    await this.getSkillOrThrow(skillId, tenantId);
    await this.db.delete(schema.skills).where(eq(schema.skills.id, skillId));
    return { success: true };
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
      const allFiles = await this.db
        .select()
        .from(schema.skillFiles)
        .where(eq(schema.skillFiles.skillId, skillId));
      files = allFiles.filter((f) => fileIds.includes(f.id));
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
