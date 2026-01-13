import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  DeleteBucketLifecycleCommand,
  PutObjectTaggingCommand,
  GetObjectTaggingCommand,
  DeleteObjectTaggingCommand,
  GetObjectCommand,
  type LifecycleRule,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v7 as uuidv7 } from 'uuid';
import { extname } from 'path';
import { S3_CLIENT } from './storage.constants.js';
import { env } from '@team9/shared';

export interface ListOptions {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface ListResult {
  objects: ObjectInfo[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
}

/**
 * Options for generating presigned upload credentials
 */
export interface PresignedUploadOptions {
  /** File name (used to extract extension) */
  filename?: string;
  /** Content type of the file (required for strict validation) */
  contentType?: string;
  /** Custom key prefix (e.g., 'uploads/images/') */
  prefix?: string;
  /** Custom file key (if not provided, will generate one) */
  key?: string;
  /** URL expiration in seconds (default: 300) */
  expiresIn?: number;
  /** Minimum file size in bytes (default: 1) */
  minSize?: number;
  /** Maximum file size in bytes (default: 100MB) */
  maxSize?: number;
  /** Object tags to set on upload (e.g., { status: 'pending' }) */
  tagging?: Record<string, string>;
}

/**
 * Presigned upload credentials returned to the client (POST method)
 */
export interface PresignedUploadCredentials {
  /** Presigned URL for POST upload */
  url: string;
  /** Form fields to include in the POST request */
  fields: Record<string, string>;
  /** Object key in the bucket */
  key: string;
  /** Bucket name */
  bucket: string;
  /** URL expiration timestamp */
  expiresAt: Date;
  /** Public URL to access the file after upload */
  publicUrl: string;
}

/**
 * Options for generating presigned download URL
 */
export interface PresignedDownloadOptions {
  /** URL expiration in seconds (default: 3600) */
  expiresIn?: number;
}

/**
 * File info returned after confirming upload
 */
export interface FileInfo {
  key: string;
  bucket: string;
  size: number;
  contentType?: string;
  lastModified: Date;
  etag?: string;
  url: string;
}

/**
 * Options for creating an expiration lifecycle rule
 */
export interface ExpirationRuleOptions {
  /** Rule ID (must be unique within the bucket) */
  id: string;
  /** Prefix filter - only objects with this prefix will be affected */
  prefix?: string;
  /** Number of days after which objects expire */
  expirationDays: number;
  /** Whether the rule is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Lifecycle rule info returned from getLifecycleRules
 */
export interface LifecycleRuleInfo {
  id: string;
  prefix?: string;
  tag?: { key: string; value: string };
  enabled: boolean;
  expirationDays?: number;
  expirationDate?: Date;
}

/**
 * Options for creating a tag-based expiration lifecycle rule
 */
export interface TagBasedExpirationRuleOptions {
  /** Rule ID (must be unique within the bucket) */
  id: string;
  /** Tag key to filter objects */
  tagKey: string;
  /** Tag value to filter objects */
  tagValue: string;
  /** Number of days after which objects expire */
  expirationDays: number;
  /** Whether the rule is enabled (default: true) */
  enabled?: boolean;
}

const DEFAULT_MIN_SIZE = 1;
const DEFAULT_MAX_SIZE = 100 * 1024 * 1024; // 100MB
const DEFAULT_EXPIRES_IN = 300; // 5 minutes

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly endpoint: string | undefined;

  constructor(@Inject(S3_CLIENT) private readonly s3Client: S3Client) {
    this.endpoint = env.S3_ENDPOINT;
  }

  // ==================== Frontend Direct Upload ====================

  /**
   * Generate a unique file key
   */
  generateFileKey(options?: { filename?: string; prefix?: string }): string {
    const uuid = uuidv7();
    const ext = options?.filename ? extname(options.filename) : '';
    const prefix = options?.prefix
      ? options.prefix.replace(/\/$/, '') + '/'
      : '';
    return `${prefix}${uuid}${ext}`;
  }

  /**
   * Create presigned upload credentials for frontend direct upload (POST method)
   *
   * Features:
   * - File size validation (min/max)
   * - Content-Type enforcement
   * - Secure form-based upload
   *
   * Frontend usage:
   * ```javascript
   * const formData = new FormData();
   * Object.entries(credentials.fields).forEach(([key, value]) => {
   *   formData.append(key, value);
   * });
   * formData.append('file', file); // file must be last!
   * await fetch(credentials.url, { method: 'POST', body: formData });
   * ```
   */
  async createPresignedUpload(
    bucket: string,
    options?: PresignedUploadOptions,
  ): Promise<PresignedUploadCredentials> {
    const key =
      options?.key ||
      this.generateFileKey({
        filename: options?.filename,
        prefix: options?.prefix,
      });

    const expiresIn = options?.expiresIn || DEFAULT_EXPIRES_IN;
    const minSize = options?.minSize ?? DEFAULT_MIN_SIZE;
    const maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;

    const conditions: Array<
      ['content-length-range', number, number] | ['eq', string, string]
    > = [['content-length-range', minSize, maxSize]];

    const fields: Record<string, string> = {};

    // Enforce Content-Type if provided
    if (options?.contentType) {
      conditions.push(['eq', '$Content-Type', options.contentType]);
      fields['Content-Type'] = options.contentType;
    }

    // Set object tags on upload using S3 POST Tagging field (XML format)
    if (options?.tagging && Object.keys(options.tagging).length > 0) {
      const tagsXml = Object.entries(options.tagging)
        .map(([k, v]) => `<Tag><Key>${k}</Key><Value>${v}</Value></Tag>`)
        .join('');
      const taggingXml = `<Tagging><TagSet>${tagsXml}</TagSet></Tagging>`;
      conditions.push(['eq', '$Tagging', taggingXml]);
      fields['Tagging'] = taggingXml;
    }

    const { url, fields: presignedFields } = await createPresignedPost(
      this.s3Client,
      {
        Bucket: bucket,
        Key: key,
        Conditions: conditions,
        Fields: fields,
        Expires: expiresIn,
      },
    );

    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const publicUrl = this.getObjectUrl(bucket, key);

    this.logger.log(
      `Created presigned POST URL for ${bucket}/${key} (size: ${minSize}-${maxSize} bytes)`,
    );

    return {
      url,
      fields: presignedFields,
      key,
      bucket,
      expiresAt,
      publicUrl,
    };
  }

  /**
   * Confirm that a file was uploaded successfully
   * Call this after frontend completes the upload
   */
  async confirmUpload(bucket: string, key: string): Promise<FileInfo> {
    const exists = await this.exists(bucket, key);
    if (!exists) {
      throw new Error(`File not found: ${bucket}/${key}`);
    }

    const metadata = await this.getMetadata(bucket, key);

    return {
      key,
      bucket,
      size: metadata.contentLength || 0,
      contentType: metadata.contentType,
      lastModified: metadata.lastModified || new Date(),
      url: this.getObjectUrl(bucket, key),
    };
  }

  /**
   * Get the object URL (only accessible if bucket is public)
   * For MinIO (with endpoint): {endpoint}/{bucket}/{key}
   * For AWS S3 (no endpoint): https://{bucket}.s3.{region}.amazonaws.com/{key}
   */
  getObjectUrl(bucket: string, key: string): string {
    if (this.endpoint) {
      return `${this.endpoint}/${bucket}/${key}`;
    }
    // AWS S3 URL format
    const region = env.S3_REGION;
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  /**
   * @deprecated Use getObjectUrl instead
   */
  getPublicUrl(bucket: string, key: string): string {
    return this.getObjectUrl(bucket, key);
  }

  /**
   * Create a presigned download URL for temporary access to a private object
   *
   * @param bucket - The bucket name
   * @param key - The object key
   * @param expiresIn - URL expiration in seconds (default: 3600 = 1 hour)
   * @returns Presigned URL for downloading the object
   *
   * @example
   * const url = await storageService.createPresignedDownload('my-bucket', 'file.pdf');
   * // URL valid for 1 hour
   *
   * const url = await storageService.createPresignedDownload('my-bucket', 'file.pdf', 86400);
   * // URL valid for 24 hours
   */
  async createPresignedDownload(
    bucket: string,
    key: string,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn });

    this.logger.debug(
      `Created presigned download URL for ${bucket}/${key} (expires in ${expiresIn}s)`,
    );

    return url;
  }

  // ==================== File Operations ====================

  /**
   * Delete a file
   */
  async delete(bucket: string, key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.s3Client.send(command);
    this.logger.log(`Deleted file ${bucket}/${key}`);
  }

  /**
   * Delete multiple files
   */
  async deleteMany(bucket: string, keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(bucket, key)));
  }

  /**
   * List objects in a bucket
   */
  async list(bucket: string, options?: ListOptions): Promise<ListResult> {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: options?.prefix,
      MaxKeys: options?.maxKeys,
      ContinuationToken: options?.continuationToken,
    });

    const response = await this.s3Client.send(command);

    return {
      objects: (response.Contents || []).map((obj) => ({
        key: obj.Key!,
        size: obj.Size!,
        lastModified: obj.LastModified!,
        etag: obj.ETag,
      })),
      isTruncated: response.IsTruncated || false,
      nextContinuationToken: response.NextContinuationToken,
    };
  }

  /**
   * Check if an object exists
   */
  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'NotFound'
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get object metadata
   */
  async getMetadata(
    bucket: string,
    key: string,
  ): Promise<{
    contentType?: string;
    contentLength?: number;
    lastModified?: Date;
    metadata?: Record<string, string>;
  }> {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);

    return {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
      metadata: response.Metadata,
    };
  }

  /**
   * Copy an object within or between buckets
   */
  async copy(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string,
  ): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: destBucket,
      Key: destKey,
      CopySource: `${sourceBucket}/${sourceKey}`,
    });

    await this.s3Client.send(command);
    this.logger.log(
      `Copied ${sourceBucket}/${sourceKey} to ${destBucket}/${destKey}`,
    );
  }

  /**
   * Move an object (copy + delete)
   */
  async move(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string,
  ): Promise<void> {
    await this.copy(sourceBucket, sourceKey, destBucket, destKey);
    await this.delete(sourceBucket, sourceKey);
    this.logger.log(
      `Moved ${sourceBucket}/${sourceKey} to ${destBucket}/${destKey}`,
    );
  }

  // ==================== Bucket Operations ====================

  /**
   * Create a bucket
   */
  async createBucket(bucket: string): Promise<void> {
    const command = new CreateBucketCommand({
      Bucket: bucket,
    });

    await this.s3Client.send(command);
    this.logger.log(`Created bucket ${bucket}`);
  }

  /**
   * Check if a bucket exists
   */
  async bucketExists(bucket: string): Promise<boolean> {
    try {
      const command = new HeadBucketCommand({
        Bucket: bucket,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        (error.name === 'NotFound' || error.name === 'NoSuchBucket')
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Ensure a bucket exists, create if not
   */
  async ensureBucket(bucket: string): Promise<void> {
    const exists = await this.bucketExists(bucket);
    if (!exists) {
      await this.createBucket(bucket);
    }
  }

  /**
   * Get the underlying S3 client for advanced operations
   */
  getClient(): S3Client {
    return this.s3Client;
  }

  // ==================== Lifecycle Rules ====================

  /**
   * Set lifecycle rules on a bucket for automatic object expiration
   *
   * @example
   * // Delete objects with 'temp/' prefix after 7 days
   * await storageService.setLifecycleRules('my-bucket', [
   *   { id: 'delete-temp', prefix: 'temp/', expirationDays: 7 }
   * ]);
   *
   * // Delete all objects after 30 days
   * await storageService.setLifecycleRules('my-bucket', [
   *   { id: 'delete-all', expirationDays: 30 }
   * ]);
   */
  async setLifecycleRules(
    bucket: string,
    rules: ExpirationRuleOptions[],
  ): Promise<void> {
    const lifecycleRules: LifecycleRule[] = rules.map((rule) => ({
      ID: rule.id,
      Status: rule.enabled !== false ? 'Enabled' : 'Disabled',
      Filter: {
        Prefix: rule.prefix ?? '',
      },
      Expiration: {
        Days: rule.expirationDays,
      },
    }));

    const command = new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: lifecycleRules,
      },
    });

    await this.s3Client.send(command);
    this.logger.log(
      `Set ${rules.length} lifecycle rule(s) on bucket ${bucket}`,
    );
  }

  /**
   * Add a single expiration rule to existing rules
   * If a rule with the same ID exists, it will be replaced
   */
  async addExpirationRule(
    bucket: string,
    rule: ExpirationRuleOptions,
  ): Promise<void> {
    const existingRules = await this.getLifecycleRules(bucket);
    const filteredRules = existingRules.filter((r) => r.id !== rule.id);

    const allRules: ExpirationRuleOptions[] = [
      ...filteredRules.map((r) => ({
        id: r.id,
        prefix: r.prefix,
        expirationDays: r.expirationDays ?? 0,
        enabled: r.enabled,
      })),
      rule,
    ].filter((r) => r.expirationDays > 0);

    await this.setLifecycleRules(bucket, allRules);
  }

  /**
   * Get lifecycle rules from a bucket
   */
  async getLifecycleRules(bucket: string): Promise<LifecycleRuleInfo[]> {
    try {
      const command = new GetBucketLifecycleConfigurationCommand({
        Bucket: bucket,
      });

      const response = await this.s3Client.send(command);

      return (response.Rules || []).map((rule) => {
        const info: LifecycleRuleInfo = {
          id: rule.ID || '',
          enabled: rule.Status === 'Enabled',
          expirationDays: rule.Expiration?.Days,
          expirationDate: rule.Expiration?.Date,
        };
        if (rule.Filter?.Prefix) {
          info.prefix = rule.Filter.Prefix;
        }
        if (rule.Filter?.Tag) {
          info.tag = {
            key: rule.Filter.Tag.Key || '',
            value: rule.Filter.Tag.Value || '',
          };
        }
        return info;
      });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'NoSuchLifecycleConfiguration'
      ) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Remove a specific lifecycle rule by ID
   */
  async removeLifecycleRule(bucket: string, ruleId: string): Promise<void> {
    const existingRules = await this.getLifecycleRules(bucket);
    const filteredRules = existingRules.filter((r) => r.id !== ruleId);

    if (filteredRules.length === 0) {
      await this.deleteLifecycleRules(bucket);
    } else {
      const rules: ExpirationRuleOptions[] = filteredRules
        .filter((r) => r.expirationDays !== undefined)
        .map((r) => ({
          id: r.id,
          prefix: r.prefix,
          expirationDays: r.expirationDays!,
          enabled: r.enabled,
        }));

      await this.setLifecycleRules(bucket, rules);
    }

    this.logger.log(`Removed lifecycle rule '${ruleId}' from bucket ${bucket}`);
  }

  /**
   * Delete all lifecycle rules from a bucket
   */
  async deleteLifecycleRules(bucket: string): Promise<void> {
    const command = new DeleteBucketLifecycleCommand({
      Bucket: bucket,
    });

    await this.s3Client.send(command);
    this.logger.log(`Deleted all lifecycle rules from bucket ${bucket}`);
  }

  /**
   * Set a tag-based lifecycle rule for automatic object expiration
   *
   * @example
   * // Delete objects with tag status=pending after 1 day
   * await storageService.setTagBasedLifecycleRule('my-bucket', {
   *   id: 'delete-pending',
   *   tagKey: 'status',
   *   tagValue: 'pending',
   *   expirationDays: 1
   * });
   */
  async setTagBasedLifecycleRule(
    bucket: string,
    options: TagBasedExpirationRuleOptions,
  ): Promise<void> {
    const existingRules = await this.getLifecycleRules(bucket);
    const filteredRules = existingRules.filter((r) => r.id !== options.id);

    const lifecycleRules: LifecycleRule[] = [
      // Keep existing rules (convert back to LifecycleRule format)
      ...filteredRules
        .filter((r) => r.expirationDays !== undefined)
        .map((r) => {
          const rule: LifecycleRule = {
            ID: r.id,
            Status: r.enabled ? 'Enabled' : 'Disabled',
            Expiration: { Days: r.expirationDays },
            Filter: {},
          };
          if (r.prefix) {
            rule.Filter = { Prefix: r.prefix };
          } else if (r.tag) {
            rule.Filter = { Tag: { Key: r.tag.key, Value: r.tag.value } };
          }
          return rule;
        }),
      // Add new tag-based rule
      {
        ID: options.id,
        Status: options.enabled !== false ? 'Enabled' : 'Disabled',
        Filter: {
          Tag: {
            Key: options.tagKey,
            Value: options.tagValue,
          },
        },
        Expiration: {
          Days: options.expirationDays,
        },
      },
    ];

    const command = new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: lifecycleRules,
      },
    });

    await this.s3Client.send(command);
    this.logger.log(
      `Set tag-based lifecycle rule '${options.id}' on bucket ${bucket}: ${options.tagKey}=${options.tagValue} expires in ${options.expirationDays} days`,
    );
  }

  // ==================== Object Tagging ====================

  /**
   * Set tags on an object
   *
   * @example
   * await storageService.setObjectTags('my-bucket', 'file.pdf', {
   *   status: 'pending',
   *   uploadedBy: 'user123'
   * });
   */
  async setObjectTags(
    bucket: string,
    key: string,
    tags: Record<string, string>,
  ): Promise<void> {
    const command = new PutObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
      Tagging: {
        TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
      },
    });

    await this.s3Client.send(command);
    this.logger.debug(`Set tags on ${bucket}/${key}: ${JSON.stringify(tags)}`);
  }

  /**
   * Get tags from an object
   */
  async getObjectTags(
    bucket: string,
    key: string,
  ): Promise<Record<string, string>> {
    const command = new GetObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    const tags: Record<string, string> = {};

    for (const tag of response.TagSet || []) {
      if (tag.Key && tag.Value !== undefined) {
        tags[tag.Key] = tag.Value;
      }
    }

    return tags;
  }

  /**
   * Delete all tags from an object
   */
  async deleteObjectTags(bucket: string, key: string): Promise<void> {
    const command = new DeleteObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.s3Client.send(command);
    this.logger.debug(`Deleted tags from ${bucket}/${key}`);
  }

  /**
   * Update a single tag on an object (preserves other tags)
   */
  async updateObjectTag(
    bucket: string,
    key: string,
    tagKey: string,
    tagValue: string,
  ): Promise<void> {
    const existingTags = await this.getObjectTags(bucket, key);
    existingTags[tagKey] = tagValue;
    await this.setObjectTags(bucket, key, existingTags);
  }

  /**
   * Remove a single tag from an object (preserves other tags)
   */
  async removeObjectTag(
    bucket: string,
    key: string,
    tagKey: string,
  ): Promise<void> {
    const existingTags = await this.getObjectTags(bucket, key);
    delete existingTags[tagKey];

    if (Object.keys(existingTags).length === 0) {
      await this.deleteObjectTags(bucket, key);
    } else {
      await this.setObjectTags(bucket, key, existingTags);
    }
  }
}
