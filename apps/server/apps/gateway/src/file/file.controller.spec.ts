import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FileController } from './file.controller.js';

function createFileServiceMock() {
  return {
    createPresignedUpload: jest.fn<any>(),
    confirmUpload: jest.fn<any>(),
    getDownloadUrl: jest.fn<any>(),
    getPublicDownloadUrl: jest.fn<any>(),
    updateVisibility: jest.fn<any>(),
    deleteFile: jest.fn<any>(),
  };
}

describe('FileController', () => {
  let controller: FileController;
  let fileService: ReturnType<typeof createFileServiceMock>;

  beforeEach(() => {
    fileService = createFileServiceMock();
    controller = new FileController(fileService as never);
  });

  it('throws when tenant header is missing for protected workspace-scoped handlers', async () => {
    await expect(
      controller.createPresignedUpload(undefined as never, {} as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.confirmUpload(undefined as never, 'user-1', {} as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.getDownloadUrl(
        undefined as never,
        'user-1',
        'file-key',
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.getPublicDownloadUrl(
        undefined as never,
        'file-key',
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.updateVisibility(
        undefined as never,
        'user-1',
        'file-key',
        'public' as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.deleteFile(undefined as never, 'user-1', 'file-key'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('delegates createPresignedUpload and confirmUpload', async () => {
    const creds = { uploadUrl: 'https://upload.test' };
    const confirmResult = { key: 'file-key' };
    fileService.createPresignedUpload.mockResolvedValue(creds);
    fileService.confirmUpload.mockResolvedValue(confirmResult);

    await expect(
      controller.createPresignedUpload('tenant-1', { name: 'a.png' } as never),
    ).resolves.toEqual(creds);
    await expect(
      controller.confirmUpload('tenant-1', 'user-1', {
        fileKey: 'file-key',
      } as never),
    ).resolves.toEqual(confirmResult);

    expect(fileService.createPresignedUpload).toHaveBeenCalledWith('tenant-1', {
      name: 'a.png',
    });
    expect(fileService.confirmUpload).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      { fileKey: 'file-key' },
    );
  });

  it('delegates download URL handlers with expiresIn', async () => {
    const result = { downloadUrl: 'https://download.test' };
    fileService.getDownloadUrl.mockResolvedValue(result);
    fileService.getPublicDownloadUrl.mockResolvedValue(result);

    await expect(
      controller.getDownloadUrl('tenant-1', 'user-1', 'file-key', {
        expiresIn: 60,
      } as never),
    ).resolves.toEqual(result);
    await expect(
      controller.getPublicDownloadUrl('tenant-1', 'file-key', {
        expiresIn: 300,
      } as never),
    ).resolves.toEqual(result);

    expect(fileService.getDownloadUrl).toHaveBeenCalledWith(
      'tenant-1',
      'file-key',
      'user-1',
      60,
    );
    expect(fileService.getPublicDownloadUrl).toHaveBeenCalledWith(
      'tenant-1',
      'file-key',
      300,
    );
  });

  it('delegates visibility updates and deleteFile', async () => {
    const file = { key: 'file-key', visibility: 'channel' };
    fileService.updateVisibility.mockResolvedValue(file);
    fileService.deleteFile.mockResolvedValue(undefined);

    await expect(
      controller.updateVisibility(
        'tenant-1',
        'user-1',
        'file-key',
        'channel' as never,
        'channel-1',
      ),
    ).resolves.toEqual(file);
    await expect(
      controller.deleteFile('tenant-1', 'user-1', 'file-key'),
    ).resolves.toEqual({ success: true });

    expect(fileService.updateVisibility).toHaveBeenCalledWith(
      'tenant-1',
      'file-key',
      'user-1',
      'channel',
      'channel-1',
    );
    expect(fileService.deleteFile).toHaveBeenCalledWith(
      'tenant-1',
      'file-key',
      'user-1',
    );
  });
});
