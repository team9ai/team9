import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { S3_CLIENT } from './storage.constants.js';

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

const DEFAULT_MIN_SIZE = 1;
const DEFAULT_MAX_SIZE = 100 * 1024 * 1024; // 100MB
const DEFAULT_EXPIRES_IN = 300; // 5 minutes

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly endpoint: string;

  constructor(@Inject(S3_CLIENT) private readonly s3Client: S3Client) {
    this.endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
  }

  // ==================== Frontend Direct Upload ====================

  /**
   * Generate a unique file key
   */
  generateFileKey(options?: { filename?: string; prefix?: string }): string {
    const uuid = randomUUID();
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
    const publicUrl = this.getPublicUrl(bucket, key);

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
      url: this.getPublicUrl(bucket, key),
    };
  }

  /**
   * Get a public URL for an object
   */
  getPublicUrl(bucket: string, key: string): string {
    return `${this.endpoint}/${bucket}/${key}`;
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
}
