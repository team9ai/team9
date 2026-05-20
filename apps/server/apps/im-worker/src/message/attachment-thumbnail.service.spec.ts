import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import sharp from 'sharp';
import { AttachmentThumbnailService } from './attachment-thumbnail.service.js';

describe('AttachmentThumbnailService', () => {
  const originalBucket = process.env.S3_BUCKET;
  const originalPublicUrl = process.env.S3_PUBLIC_URL;

  beforeEach(() => {
    process.env.S3_BUCKET = 't9-test';
    process.env.S3_PUBLIC_URL = 'https://cdn.example/t9-test';
  });

  afterEach(() => {
    process.env.S3_BUCKET = originalBucket;
    process.env.S3_PUBLIC_URL = originalPublicUrl;
    jest.restoreAllMocks();
  });

  it('creates a small webp thumbnail object for owned image attachments', async () => {
    const source = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    const storage = {
      getObjectBuffer: jest.fn<any>().mockResolvedValue({ buffer: source }),
      putObject: jest.fn<any>().mockResolvedValue(undefined),
      getObjectUrl: jest.fn<any>(),
    };
    const service = new AttachmentThumbnailService(storage as never);

    const url = await service.createThumbnail({
      fileKey: 'workspace-1/2026-05/image.png',
      fileName: 'image.png',
      fileSize: source.length,
      mimeType: 'image/png',
    });

    expect(url).toBe(
      'https://cdn.example/t9-test/workspace-1/2026-05/thumbnails/image.webp',
    );
    expect(storage.getObjectBuffer).toHaveBeenCalledWith(
      't9-test',
      'workspace-1/2026-05/image.png',
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      't9-test',
      'workspace-1/2026-05/thumbnails/image.webp',
      expect.any(Buffer),
      { contentType: 'image/webp' },
    );
  });

  it('skips non-image attachments', async () => {
    const storage = {
      getObjectBuffer: jest.fn<any>(),
      putObject: jest.fn<any>(),
      getObjectUrl: jest.fn<any>(),
    };
    const service = new AttachmentThumbnailService(storage as never);

    const url = await service.createThumbnail({
      fileKey: 'workspace-1/2026-05/report.pdf',
      fileName: 'report.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
    });

    expect(url).toBeNull();
    expect(storage.getObjectBuffer).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});
