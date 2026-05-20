import { Injectable, Logger, Optional } from '@nestjs/common';
import { StorageService } from '@team9/storage';
import { env, type CreateMessageAttachmentDto } from '@team9/shared';
import sharp from 'sharp';

const THUMBNAIL_MAX_EDGE = 480;
const THUMBNAIL_QUALITY = 76;
const THUMBNAIL_CONTENT_TYPE = 'image/webp';
const THUMBNAIL_SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

@Injectable()
export class AttachmentThumbnailService {
  private readonly logger = new Logger(AttachmentThumbnailService.name);

  constructor(@Optional() private readonly storageService?: StorageService) {}

  async createThumbnail(
    attachment: CreateMessageAttachmentDto,
  ): Promise<string | null> {
    if (!this.storageService || !this.shouldCreateThumbnail(attachment)) {
      return null;
    }

    const bucket = env.S3_BUCKET;
    const sourceKey = attachment.fileKey as string;
    const thumbnailKey = this.getThumbnailKey(sourceKey);

    try {
      const source = await this.storageService.getObjectBuffer(
        bucket,
        sourceKey,
      );
      const thumbnail = await sharp(source.buffer, { failOn: 'none' })
        .rotate()
        .resize({
          width: THUMBNAIL_MAX_EDGE,
          height: THUMBNAIL_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: THUMBNAIL_QUALITY })
        .toBuffer();

      await this.storageService.putObject(bucket, thumbnailKey, thumbnail, {
        contentType: THUMBNAIL_CONTENT_TYPE,
      });

      return this.buildPublicUrl(thumbnailKey);
    } catch (error) {
      this.logger.warn(
        `Failed to create thumbnail for ${sourceKey}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private shouldCreateThumbnail(
    attachment: CreateMessageAttachmentDto,
  ): boolean {
    return (
      typeof attachment.fileKey === 'string' &&
      THUMBNAIL_SUPPORTED_MIME_TYPES.has(attachment.mimeType.toLowerCase())
    );
  }

  private getThumbnailKey(sourceKey: string): string {
    const slashIndex = sourceKey.lastIndexOf('/');
    const dir = slashIndex >= 0 ? sourceKey.slice(0, slashIndex + 1) : '';
    const fileName =
      slashIndex >= 0 ? sourceKey.slice(slashIndex + 1) : sourceKey;
    const stem = fileName.replace(/\.[^.]*$/, '') || fileName;
    return `${dir}thumbnails/${stem}.webp`;
  }

  private buildPublicUrl(key: string): string {
    const baseUrl = env.S3_PUBLIC_URL;
    if (baseUrl) {
      return `${baseUrl.replace(/\/$/, '')}/${key}`;
    }
    return this.storageService!.getObjectUrl(env.S3_BUCKET, key);
  }
}
