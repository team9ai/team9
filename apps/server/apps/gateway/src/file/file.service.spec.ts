import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FileService, type FileRecord } from './file.service.js';

function createDbMock() {
  const selectLimit = jest.fn<any>().mockResolvedValue([]);
  const selectWhere = jest.fn<any>().mockReturnValue({ limit: selectLimit });
  const selectFrom = jest.fn<any>().mockReturnValue({ where: selectWhere });

  const insertReturning = jest.fn<any>().mockResolvedValue([]);
  const insertValues = jest
    .fn<any>()
    .mockReturnValue({ returning: insertReturning });

  const updateReturning = jest.fn<any>().mockResolvedValue([]);
  const updateWhere = jest
    .fn<any>()
    .mockReturnValue({ returning: updateReturning });
  const updateSet = jest.fn<any>().mockReturnValue({ where: updateWhere });

  const deleteWhere = jest.fn<any>().mockResolvedValue(undefined);

  return {
    select: jest.fn<any>().mockReturnValue({ from: selectFrom }),
    insert: jest.fn<any>().mockReturnValue({ values: insertValues }),
    update: jest.fn<any>().mockReturnValue({ set: updateSet }),
    delete: jest.fn<any>().mockReturnValue({ where: deleteWhere }),
    chains: {
      selectFrom,
      selectWhere,
      selectLimit,
      insertValues,
      insertReturning,
      updateSet,
      updateWhere,
      updateReturning,
      deleteWhere,
    },
  };
}

function createStorageMock() {
  return {
    ensureBucket: jest.fn<any>().mockResolvedValue(undefined),
    setTagBasedLifecycleRule: jest.fn<any>().mockResolvedValue(undefined),
    createPresignedUpload: jest.fn<any>().mockResolvedValue({
      key: 'uploads/file.txt',
      uploadUrl: 'https://upload.example/file.txt',
      headers: { 'x-test': '1' },
    }),
    confirmUpload: jest.fn<any>().mockResolvedValue({
      size: 42,
      contentType: 'image/png',
    }),
    setObjectTags: jest.fn<any>().mockResolvedValue(undefined),
    createPresignedDownload: jest
      .fn<any>()
      .mockResolvedValue('https://download.example/file.txt'),
    delete: jest.fn<any>().mockResolvedValue(undefined),
  };
}

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 'file-1',
    key: 'uploads/file.txt',
    bucket: 'files-bucket',
    fileName: 'file.txt',
    fileSize: 42,
    mimeType: 'text/plain',
    visibility: 'workspace',
    tenantId: 'ws-1',
    channelId: null,
    uploaderId: 'user-1',
    createdAt: new Date('2026-04-02T10:30:00.000Z'),
    ...overrides,
  };
}

describe('FileService', () => {
  let service: FileService;
  let db: ReturnType<typeof createDbMock>;
  let storage: ReturnType<typeof createStorageMock>;
  let eventEmitter: { emit: jest.Mock<any> };
  let logger: {
    log: jest.Mock<any>;
    warn: jest.Mock<any>;
    debug: jest.Mock<any>;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-02T10:30:00.000Z'));

    db = createDbMock();
    storage = createStorageMock();
    eventEmitter = { emit: jest.fn<any>() };
    service = new FileService(
      storage as never,
      db as never,
      eventEmitter as never,
    );
    logger = {
      log: jest.fn<any>(),
      warn: jest.fn<any>(),
      debug: jest.fn<any>(),
    };
    (service as any).logger = logger;

    jest.spyOn(service, 'getBucketName').mockReturnValue('files-bucket');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('builds workspace file prefixes from the current month', () => {
    expect(service.getFilePrefix('ws-1')).toBe('workspace-ws-1/2026-04/');
  });

  it('creates presigned uploads and initializes bucket lifecycle only once', async () => {
    const dto = {
      filename: 'notes.txt',
      contentType: 'text/plain',
      fileSize: 128,
    } as never;

    await expect(service.createPresignedUpload('ws-1', dto)).resolves.toEqual({
      key: 'uploads/file.txt',
      uploadUrl: 'https://upload.example/file.txt',
      headers: { 'x-test': '1' },
    });
    await service.createPresignedUpload('ws-1', dto);

    expect(storage.ensureBucket).toHaveBeenCalledTimes(1);
    expect(storage.setTagBasedLifecycleRule).toHaveBeenCalledTimes(1);
    expect(storage.createPresignedUpload).toHaveBeenCalledWith(
      'files-bucket',
      expect.objectContaining({
        filename: 'notes.txt',
        contentType: 'text/plain',
        prefix: 'workspace-ws-1/2026-04/',
        maxSize: 200 * 1024 * 1024,
        tagging: { status: 'pending' },
      }),
    );
  });

  it('continues uploading when lifecycle configuration fails', async () => {
    storage.setTagBasedLifecycleRule.mockRejectedValueOnce(new Error('boom'));

    await expect(
      service.createPresignedUpload('ws-1', {
        filename: 'image.png',
        contentType: 'image/png',
        fileSize: 512,
      } as never),
    ).resolves.toEqual(expect.objectContaining({ key: 'uploads/file.txt' }));

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to set lifecycle rule on bucket files-bucket: Error: boom',
    );
    expect(storage.createPresignedUpload).toHaveBeenCalledTimes(1);
  });

  it('confirms uploads, stores records, and emits file.created events', async () => {
    const persistedFile = makeFile({
      key: 'uploads/image.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      visibility: 'channel',
      channelId: 'channel-1',
    });
    db.chains.insertReturning.mockResolvedValue([persistedFile]);
    db.chains.selectLimit
      .mockResolvedValueOnce([{ id: 'channel-1', name: 'general' }])
      .mockResolvedValueOnce([{ id: 'user-1', username: 'alice' }]);

    await expect(
      service.confirmUpload('ws-1', 'user-1', {
        key: 'uploads/image.png',
        fileName: 'image.png',
        visibility: 'channel',
        channelId: 'channel-1',
      } as never),
    ).resolves.toEqual({
      id: expect.any(String),
      key: 'uploads/image.png',
      fileName: 'image.png',
      fileSize: 42,
      mimeType: 'image/png',
      visibility: 'channel',
    });

    expect(storage.confirmUpload).toHaveBeenCalledWith(
      'files-bucket',
      'uploads/image.png',
    );
    expect(storage.setObjectTags).toHaveBeenCalledWith(
      'files-bucket',
      'uploads/image.png',
      { status: 'confirmed' },
    );
    expect(db.chains.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'uploads/image.png',
        bucket: 'files-bucket',
        visibility: 'channel',
        channelId: 'channel-1',
        tenantId: 'ws-1',
        uploaderId: 'user-1',
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('file.created', {
      file: persistedFile,
      channel: { id: 'channel-1', name: 'general' },
      uploader: { id: 'user-1', username: 'alice' },
    });
  });

  it('defaults confirmed uploads to workspace visibility and octet-stream mime type', async () => {
    storage.confirmUpload.mockResolvedValueOnce({
      size: 9,
      contentType: null,
    });
    const persistedFile = makeFile({
      key: 'uploads/archive.bin',
      fileName: 'archive.bin',
      fileSize: 9,
      mimeType: 'application/octet-stream',
    });
    db.chains.insertReturning.mockResolvedValue([persistedFile]);
    db.chains.selectLimit.mockResolvedValueOnce([{ id: 'user-1' }]);

    await expect(
      service.confirmUpload('ws-1', 'user-1', {
        key: 'uploads/archive.bin',
        fileName: 'archive.bin',
      } as never),
    ).resolves.toEqual({
      id: expect.any(String),
      key: 'uploads/archive.bin',
      fileName: 'archive.bin',
      fileSize: 9,
      mimeType: 'application/octet-stream',
      visibility: 'workspace',
    });

    expect(db.chains.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: 'workspace',
        channelId: null,
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('file.created', {
      file: persistedFile,
      channel: undefined,
      uploader: { id: 'user-1' },
    });
  });

  it('checks workspace and channel membership before granting access', async () => {
    db.chains.selectLimit
      .mockResolvedValueOnce([{ tenantId: 'ws-1', userId: 'user-1' }])
      .mockResolvedValueOnce([{ channelId: 'channel-1', userId: 'user-1' }]);

    await expect(
      service.checkFileAccess(
        makeFile({ visibility: 'workspace' }),
        'user-1',
        'ws-1',
      ),
    ).resolves.toBe(true);
    await expect(
      service.checkFileAccess(
        makeFile({ visibility: 'channel', channelId: 'channel-1' }),
        'user-1',
        'ws-1',
      ),
    ).resolves.toBe(true);

    await expect(
      service.checkFileAccess(
        makeFile({ visibility: 'workspace' }),
        'user-1',
        'other-ws',
      ),
    ).resolves.toBe(false);
    await expect(
      service.checkFileAccess(
        makeFile({ visibility: 'channel', channelId: 'channel-1' }),
        null,
        'ws-1',
      ),
    ).resolves.toBe(false);
  });

  it('grants public files to anyone and private files only to the uploader', async () => {
    await expect(
      service.checkFileAccess(makeFile({ visibility: 'public' }), null, null),
    ).resolves.toBe(true);
    await expect(
      service.checkFileAccess(
        makeFile({ visibility: 'private' }),
        'user-1',
        'ws-1',
      ),
    ).resolves.toBe(true);
    await expect(
      service.checkFileAccess(
        makeFile({ visibility: 'private' }),
        'user-2',
        'ws-1',
      ),
    ).resolves.toBe(false);
  });

  it('creates download URLs only when the file exists and access is allowed', async () => {
    const file = makeFile({ key: 'uploads/report.pdf' });
    jest.spyOn(service, 'getFileByKey').mockResolvedValue(file);
    jest.spyOn(service, 'checkFileAccess').mockResolvedValue(true);

    await expect(
      service.getDownloadUrl('ws-1', 'uploads/report.pdf', 'user-1', 120),
    ).resolves.toEqual({
      url: 'https://download.example/file.txt',
      expiresAt: new Date('2026-04-02T10:32:00.000Z'),
    });

    expect(storage.createPresignedDownload).toHaveBeenCalledWith(
      'files-bucket',
      'uploads/report.pdf',
      120,
    );
  });

  it('rejects download URLs for missing files or denied access', async () => {
    const getFileByKeySpy = jest.spyOn(service, 'getFileByKey');
    const checkFileAccessSpy = jest.spyOn(service, 'checkFileAccess');

    getFileByKeySpy.mockResolvedValueOnce(null);
    await expect(
      service.getDownloadUrl('ws-1', 'missing', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    getFileByKeySpy.mockResolvedValueOnce(makeFile());
    checkFileAccessSpy.mockResolvedValueOnce(false);
    await expect(
      service.getDownloadUrl('ws-1', 'uploads/file.txt', 'user-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns public download URLs only for public files', async () => {
    const getFileByKeySpy = jest.spyOn(service, 'getFileByKey');
    getFileByKeySpy
      .mockResolvedValueOnce(makeFile({ visibility: 'public' }))
      .mockResolvedValueOnce(makeFile({ visibility: 'workspace' }));

    await expect(
      service.getPublicDownloadUrl('ws-1', 'uploads/file.txt', 60),
    ).resolves.toEqual({
      url: 'https://download.example/file.txt',
      expiresAt: new Date('2026-04-02T10:31:00.000Z'),
    });

    await expect(
      service.getPublicDownloadUrl('ws-1', 'uploads/file.txt'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updates visibility only for the uploader', async () => {
    const file = makeFile();
    const updatedFile = makeFile({
      visibility: 'channel',
      channelId: 'channel-9',
    });
    jest.spyOn(service, 'getFileByKey').mockResolvedValue(file);
    db.chains.updateReturning.mockResolvedValueOnce([updatedFile]);

    await expect(
      service.updateVisibility(
        'ws-1',
        'uploads/file.txt',
        'user-1',
        'channel',
        'channel-9',
      ),
    ).resolves.toEqual(updatedFile);

    expect(db.chains.updateSet).toHaveBeenCalledWith({
      visibility: 'channel',
      channelId: 'channel-9',
    });

    jest
      .spyOn(service, 'getFileByKey')
      .mockResolvedValueOnce(makeFile({ uploaderId: 'user-2' }));
    await expect(
      service.updateVisibility('ws-1', 'uploads/file.txt', 'user-1', 'public'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deletes files from storage and emits a removal event', async () => {
    jest.spyOn(service, 'getFileByKey').mockResolvedValue(makeFile());

    await expect(
      service.deleteFile('ws-1', 'uploads/file.txt', 'user-1'),
    ).resolves.toBeUndefined();

    expect(storage.delete).toHaveBeenCalledWith(
      'files-bucket',
      'uploads/file.txt',
    );
    expect(db.delete).toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith('file.deleted', 'file-1');
  });

  it('rejects deleting files when the requester is not the uploader', async () => {
    jest
      .spyOn(service, 'getFileByKey')
      .mockResolvedValue(makeFile({ uploaderId: 'user-2' }));

    await expect(
      service.deleteFile('ws-1', 'uploads/file.txt', 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(storage.delete).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
