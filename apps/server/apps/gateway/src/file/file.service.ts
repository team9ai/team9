import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  StorageService,
  PresignedUploadCredentials,
  FileInfo,
} from '@team9/storage';
import { env } from '@team9/shared';
import { CreatePresignedUploadDto } from './dto/index.js';

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const PENDING_EXPIRATION_DAYS = 1; // Auto-delete pending files after 1 day

// Tag constants
const TAG_STATUS_KEY = 'status';
const TAG_STATUS_PENDING = 'pending';
const TAG_STATUS_CONFIRMED = 'confirmed';

// Lifecycle rule ID
const LIFECYCLE_RULE_ID = 'auto-delete-pending-uploads';

@Injectable()
export class FileService implements OnModuleInit {
  private readonly logger = new Logger(FileService.name);
  private readonly initializedBuckets = new Set<string>();

  constructor(private readonly storageService: StorageService) {}

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
   * Confirm upload completion - changes tag from pending to confirmed
   * This prevents the file from being auto-deleted
   */
  async confirmUpload(workspaceId: string, key: string): Promise<FileInfo> {
    const bucket = this.getBucketName(workspaceId);

    // Verify file exists
    const fileInfo = await this.storageService.confirmUpload(bucket, key);

    // Change tag to confirmed (removes from lifecycle rule scope)
    await this.storageService.setObjectTags(bucket, key, {
      [TAG_STATUS_KEY]: TAG_STATUS_CONFIRMED,
    });

    return fileInfo;
  }

  /**
   * Delete a file
   */
  async deleteFile(workspaceId: string, key: string): Promise<void> {
    const bucket = this.getBucketName(workspaceId);
    await this.storageService.delete(bucket, key);
  }
}
