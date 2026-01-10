import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  StorageService,
  PresignedUploadCredentials,
  FileInfo,
} from '@team9/storage';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { env } from '@team9/shared';
import {
  CreatePresignedUploadDto,
  ConfirmUploadDto,
  FileVisibility,
} from './dto/index.js';

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const PENDING_EXPIRATION_DAYS = 1; // Auto-delete pending files after 1 day
const DEFAULT_DOWNLOAD_EXPIRES_IN = 8 * 3600; // 8 hours

// Tag constants
const TAG_STATUS_KEY = 'status';
const TAG_STATUS_PENDING = 'pending';
const TAG_STATUS_CONFIRMED = 'confirmed';

// Lifecycle rule ID
const LIFECYCLE_RULE_ID = 'auto-delete-pending-uploads';

export interface FileRecord {
  id: string;
  key: string;
  bucket: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  visibility: FileVisibility;
  tenantId: string;
  channelId: string | null;
  uploaderId: string;
  createdAt: Date;
}

export interface ConfirmUploadResult extends FileInfo {
  fileId: string;
  visibility: FileVisibility;
}

export interface DownloadUrlResult {
  url: string;
  expiresAt: Date;
}

@Injectable()
export class FileService implements OnModuleInit {
  private readonly logger = new Logger(FileService.name);
  private readonly initializedBuckets = new Set<string>();

  constructor(
    private readonly storageService: StorageService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `FileService initialized with ${PENDING_EXPIRATION_DAYS} day expiration for pending uploads`,
    );
  }

  /**
   * Generate bucket name based on environment and workspace
   */
  getBucketName(workspaceId: string): string {
    const appEnv = env.APP_ENV;
    return `t9-${appEnv}-${workspaceId}`;
  }

  /**
   * Generate file path prefix: userId/yyyy-mm/
   */
  getFilePrefix(userId: string): string {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return `${userId}/${yearMonth}/`;
  }

  /**
   * Ensure bucket exists and has lifecycle rule for pending uploads
   */
  private async ensureBucketWithLifecycle(bucket: string): Promise<void> {
    // Skip if already initialized in this process
    if (this.initializedBuckets.has(bucket)) {
      return;
    }

    await this.storageService.ensureBucket(bucket);

    // Set lifecycle rule for auto-deleting pending uploads
    try {
      await this.storageService.setTagBasedLifecycleRule(bucket, {
        id: LIFECYCLE_RULE_ID,
        tagKey: TAG_STATUS_KEY,
        tagValue: TAG_STATUS_PENDING,
        expirationDays: PENDING_EXPIRATION_DAYS,
      });
    } catch (error) {
      // Log warning but don't fail - lifecycle is optional
      this.logger.warn(
        `Failed to set lifecycle rule on bucket ${bucket}: ${error}`,
      );
    }

    this.initializedBuckets.add(bucket);
  }

  /**
   * Create presigned upload credentials
   * Files are tagged as 'pending' on upload and will auto-delete after 1 day if not confirmed
   */
  async createPresignedUpload(
    workspaceId: string,
    userId: string,
    dto: CreatePresignedUploadDto,
  ): Promise<PresignedUploadCredentials> {
    const bucket = this.getBucketName(workspaceId);
    await this.ensureBucketWithLifecycle(bucket);

    return this.storageService.createPresignedUpload(bucket, {
      filename: dto.filename,
      contentType: dto.contentType,
      prefix: this.getFilePrefix(userId),
      maxSize: MAX_FILE_SIZE,
      // Tag as pending - will be auto-deleted by lifecycle rule if not confirmed
      tagging: { [TAG_STATUS_KEY]: TAG_STATUS_PENDING },
    });
  }

  /**
   * Confirm upload completion
   * - Changes tag from pending to confirmed (prevents auto-deletion)
   * - Saves file record to database with visibility settings
   */
  async confirmUpload(
    workspaceId: string,
    userId: string,
    dto: ConfirmUploadDto,
  ): Promise<ConfirmUploadResult> {
    const bucket = this.getBucketName(workspaceId);

    // Verify file exists in storage and get metadata
    const fileInfo = await this.storageService.confirmUpload(bucket, dto.key);

    // Change tag to confirmed (removes from lifecycle rule scope)
    await this.storageService.setObjectTags(bucket, dto.key, {
      [TAG_STATUS_KEY]: TAG_STATUS_CONFIRMED,
    });

    // Save file record to database
    const fileId = uuidv7();
    const visibility = dto.visibility || 'workspace';

    await this.db.insert(schema.files).values({
      id: fileId,
      key: dto.key,
      bucket,
      fileName: dto.fileName,
      fileSize: fileInfo.size,
      mimeType: fileInfo.contentType || 'application/octet-stream',
      visibility,
      tenantId: workspaceId,
      channelId: dto.channelId || null,
      uploaderId: userId,
    });

    this.logger.debug(`Confirmed upload and created file record ${fileId}`);

    return {
      ...fileInfo,
      fileId,
      visibility,
    };
  }

  /**
   * Get file record by key
   */
  async getFileByKey(
    workspaceId: string,
    key: string,
  ): Promise<FileRecord | null> {
    const [file] = await this.db
      .select()
      .from(schema.files)
      .where(
        and(eq(schema.files.tenantId, workspaceId), eq(schema.files.key, key)),
      )
      .limit(1);

    return (file as FileRecord) || null;
  }

  /**
   * Check if user has access to file based on visibility settings
   */
  async checkFileAccess(
    file: FileRecord,
    userId: string | null,
    workspaceId: string | null,
  ): Promise<boolean> {
    switch (file.visibility) {
      case 'public':
        // Anyone can access
        return true;

      case 'workspace':
        // Must be in the same workspace
        if (!workspaceId || workspaceId !== file.tenantId) {
          return false;
        }
        // Check if user is a member of the workspace
        if (userId) {
          const [member] = await this.db
            .select()
            .from(schema.tenantMembers)
            .where(
              and(
                eq(schema.tenantMembers.tenantId, file.tenantId),
                eq(schema.tenantMembers.userId, userId),
              ),
            )
            .limit(1);
          return !!member;
        }
        return false;

      case 'channel':
        // Must be a member of the channel
        if (!userId || !file.channelId) {
          return false;
        }
        const [channelMember] = await this.db
          .select()
          .from(schema.channelMembers)
          .where(
            and(
              eq(schema.channelMembers.channelId, file.channelId),
              eq(schema.channelMembers.userId, userId),
            ),
          )
          .limit(1);
        return !!channelMember;

      case 'private':
        // Only the uploader can access
        return userId === file.uploaderId;

      default:
        return false;
    }
  }

  /**
   * Get presigned download URL for a file
   * Validates access permissions before generating URL
   */
  async getDownloadUrl(
    workspaceId: string,
    key: string,
    userId: string | null,
    expiresIn = DEFAULT_DOWNLOAD_EXPIRES_IN,
  ): Promise<DownloadUrlResult> {
    const file = await this.getFileByKey(workspaceId, key);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Check access permissions
    const hasAccess = await this.checkFileAccess(file, userId, workspaceId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied to this file');
    }

    const url = await this.storageService.createPresignedDownload(
      file.bucket,
      file.key,
      expiresIn,
    );

    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    return { url, expiresAt };
  }

  /**
   * Get public download URL (for public files only, no auth required)
   */
  async getPublicDownloadUrl(
    workspaceId: string,
    key: string,
    expiresIn = DEFAULT_DOWNLOAD_EXPIRES_IN,
  ): Promise<DownloadUrlResult> {
    const file = await this.getFileByKey(workspaceId, key);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.visibility !== 'public') {
      throw new ForbiddenException('This file is not public');
    }

    const url = await this.storageService.createPresignedDownload(
      file.bucket,
      file.key,
      expiresIn,
    );

    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    return { url, expiresAt };
  }

  /**
   * Update file visibility
   */
  async updateVisibility(
    workspaceId: string,
    key: string,
    userId: string,
    visibility: FileVisibility,
    channelId?: string,
  ): Promise<FileRecord> {
    const file = await this.getFileByKey(workspaceId, key);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Only the uploader can change visibility
    if (file.uploaderId !== userId) {
      throw new ForbiddenException(
        'Only the uploader can change file visibility',
      );
    }

    const [updated] = await this.db
      .update(schema.files)
      .set({
        visibility,
        channelId: visibility === 'channel' ? channelId : null,
      })
      .where(eq(schema.files.id, file.id))
      .returning();

    this.logger.debug(`Updated file ${file.id} visibility to ${visibility}`);

    return updated as FileRecord;
  }

  /**
   * Delete a file
   */
  async deleteFile(
    workspaceId: string,
    key: string,
    userId: string,
  ): Promise<void> {
    const file = await this.getFileByKey(workspaceId, key);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Only the uploader can delete
    if (file.uploaderId !== userId) {
      throw new ForbiddenException('Only the uploader can delete this file');
    }

    // Delete from storage
    await this.storageService.delete(file.bucket, file.key);

    // Delete from database
    await this.db.delete(schema.files).where(eq(schema.files.id, file.id));

    this.logger.debug(`Deleted file ${file.id}`);
  }
}
