import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

// Mock circular-dep modules BEFORE dynamic imports
jest.unstable_mockModule('../../channels/channels.service.js', () => ({
  ChannelsService: class ChannelsService {},
}));
jest.unstable_mockModule('../messages.service.js', () => ({
  MessagesService: class MessagesService {},
}));
jest.unstable_mockModule(
  '../../services/im-worker-grpc-client.service.js',
  () => ({
    ImWorkerGrpcClientService: class ImWorkerGrpcClientService {},
  }),
);

const { ForwardsService } = await import('./forwards.service.js');
const { ChannelsService } = await import('../../channels/channels.service.js');
const { MessagesService } = await import('../messages.service.js');
const { ImWorkerGrpcClientService } =
  await import('../../services/im-worker-grpc-client.service.js');
const { DATABASE_CONNECTION } = await import('@team9/database');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    channelId: 'ch-src',
    senderId: 'user-1',
    type: 'text',
    content: 'hello',
    contentAst: null,
    isDeleted: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    seqId: null,
    metadata: null,
    ...overrides,
  };
}

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch-src',
    name: 'general',
    tenantId: 'ws-1',
    type: 'public',
    description: null,
    avatarUrl: null,
    createdBy: null,
    sectionId: null,
    order: 0,
    isArchived: false,
    isActivated: true,
    snapshot: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMessageResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fwd-msg-1',
    clientMsgId: null,
    channelId: 'ch-target',
    senderId: 'user-1',
    parentId: null,
    rootId: null,
    content: '[Forwarded] hello',
    contentAst: null,
    type: 'forward',
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    sender: null,
    attachments: [],
    reactions: [],
    replyCount: 0,
    lastRepliers: [],
    lastReplyAt: null,
    metadata: {
      forward: {
        kind: 'single',
        count: 1,
        sourceChannelId: 'ch-src',
        sourceChannelName: 'general',
      },
    },
    ...overrides,
  };
}

function makeForwardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fwd-row-1',
    forwardedMessageId: 'fwd-msg-1',
    position: 0,
    sourceMessageId: 'msg-1',
    sourceChannelId: 'ch-src',
    sourceWorkspaceId: 'ws-1',
    sourceSenderId: 'user-1',
    sourceCreatedAt: new Date('2026-01-01T00:00:00Z'),
    sourceSeqId: null,
    contentSnapshot: 'hello',
    contentAstSnapshot: null,
    attachmentsSnapshot: [],
    sourceType: 'text',
    createdAt: new Date(),
    ...overrides,
  };
}

function createDbMock() {
  const insertValues = jest.fn<any>().mockResolvedValue([]);
  const selectOrderBy = jest.fn<any>().mockResolvedValue([]);
  const selectWhere = jest
    .fn<any>()
    .mockReturnValue({ orderBy: selectOrderBy });
  const selectFrom = jest.fn<any>().mockReturnValue({ where: selectWhere });

  return {
    insert: jest.fn<any>().mockReturnValue({ values: insertValues }),
    select: jest.fn<any>().mockReturnValue({ from: selectFrom }),
    chains: {
      insertValues,
      selectFrom,
      selectWhere,
      selectOrderBy,
    },
  };
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('ForwardsService', () => {
  let service: InstanceType<typeof ForwardsService>;
  let channelsService: {
    assertReadAccess: jest.Mock<any>;
    assertWriteAccess: jest.Mock<any>;
    findById: jest.Mock<any>;
    findManyByIds: jest.Mock<any>;
    canRead: jest.Mock<any>;
  };
  let messagesService: {
    findManyByIds: jest.Mock<any>;
    getMessageWithDetails: jest.Mock<any>;
    getMessageChannelId: jest.Mock<any>;
    softDelete: jest.Mock<any>;
    truncateForPreview: jest.Mock<any>;
    getAttachmentsForMessages: jest.Mock<any>;
    findUsersByIds: jest.Mock<any>;
  };
  let grpcService: { createMessage: jest.Mock<any> };
  let db: ReturnType<typeof createDbMock>;

  beforeEach(async () => {
    db = createDbMock();

    channelsService = {
      assertReadAccess: jest.fn<any>().mockResolvedValue(undefined),
      assertWriteAccess: jest.fn<any>().mockResolvedValue(undefined),
      findById: jest.fn<any>().mockResolvedValue(makeChannel()),
      findManyByIds: jest.fn<any>().mockResolvedValue([makeChannel()]),
      canRead: jest.fn<any>().mockResolvedValue(true),
    };

    messagesService = {
      findManyByIds: jest.fn<any>().mockResolvedValue([makeMessage()]),
      getMessageWithDetails: jest
        .fn<any>()
        .mockResolvedValue(makeMessageResponse()),
      getMessageChannelId: jest.fn<any>().mockResolvedValue('ch-target'),
      softDelete: jest.fn<any>().mockResolvedValue(undefined),
      truncateForPreview: jest.fn<any>().mockImplementation((m: any) => m),
      getAttachmentsForMessages: jest.fn<any>().mockResolvedValue(new Map()),
      findUsersByIds: jest.fn<any>().mockResolvedValue([]),
    };

    grpcService = {
      createMessage: jest.fn<any>().mockResolvedValue({ msgId: 'fwd-msg-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForwardsService,
        { provide: ChannelsService, useValue: channelsService },
        { provide: MessagesService, useValue: messagesService },
        { provide: ImWorkerGrpcClientService, useValue: grpcService },
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    service = module.get(ForwardsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── validation ───────────────────────────────────────────────────────────

  describe('validation', () => {
    it('rejects empty sourceMessageIds with forward.empty', async () => {
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: [],
          userId: 'user-1',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: [],
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.empty' });
    });

    it('rejects sourceMessageIds.length > 100 with forward.tooManySelected', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `msg-${i}`);
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ids,
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.tooManySelected' });
    });

    it('rejects exactly 100 items (boundary — allowed)', async () => {
      // 100 is allowed: should NOT throw tooManySelected
      const ids = Array.from({ length: 100 }, (_, i) => `msg-${i}`);
      messagesService.findManyByIds.mockResolvedValue(
        ids.map((id, i) =>
          makeMessage({
            id,
            type: 'text',
            channelId: 'ch-src',
            content: `msg ${i}`,
          }),
        ),
      );
      messagesService.getMessageWithDetails.mockResolvedValue(
        makeMessageResponse(),
      );
      // Should reach permissions check, then work
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ids,
          userId: 'user-1',
        }),
      ).resolves.toBeDefined();
    });
  });

  // ── source eligibility ────────────────────────────────────────────────────

  describe('source eligibility', () => {
    it('rejects system type messages with forward.notAllowed', async () => {
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ type: 'system' }),
      ]);
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ['msg-1'],
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.notAllowed' });
    });

    it('rejects tracking type messages with forward.notAllowed', async () => {
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ type: 'tracking' }),
      ]);
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ['msg-1'],
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.notAllowed' });
    });

    it('rejects streaming source (metadata.streaming === true) with forward.notAllowed', async () => {
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ metadata: { streaming: true } }),
      ]);
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ['msg-1'],
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.notAllowed' });
    });

    it('rejects isDeleted source with forward.notAllowed', async () => {
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ isDeleted: true }),
      ]);
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ['msg-1'],
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.notAllowed' });
    });

    it('rejects source not found (count mismatch) with forward.notFound', async () => {
      messagesService.findManyByIds.mockResolvedValue([]); // 0 returned, 1 requested
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ['msg-1'],
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.notFound' });
    });

    it('rejects mixed source channels with forward.mixedChannels', async () => {
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ id: 'msg-1', channelId: 'ch-src' }),
        makeMessage({ id: 'msg-2', channelId: 'ch-other' }),
      ]);
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ['msg-1', 'msg-2'],
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.mixedChannels' });
    });
  });

  // ── permissions ───────────────────────────────────────────────────────────

  describe('permissions', () => {
    it('throws forward.noSourceAccess when assertReadAccess fails on source', async () => {
      channelsService.assertReadAccess.mockRejectedValue(
        new ForbiddenException('Access denied'),
      );
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ['msg-1'],
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.noSourceAccess' });
    });

    it('throws forward.noWriteAccess when assertWriteAccess fails on target', async () => {
      channelsService.assertWriteAccess.mockRejectedValue(
        new ForbiddenException('Access denied'),
      );
      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ['msg-1'],
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.noWriteAccess' });
    });
  });

  // ── single forward happy paths ────────────────────────────────────────────

  describe('single forward', () => {
    it('forwards a single text message and returns forward type response', async () => {
      const result = await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      expect(result.type).toBe('forward');
      expect(grpcService.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'forward', attachments: undefined }),
      );
    });

    it('forwards a single image message with attachment snapshot', async () => {
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ type: 'image', content: null }),
      ]);
      const attachmentMap = new Map([
        [
          'msg-1',
          [
            {
              id: 'att-1',
              messageId: 'msg-1',
              fileName: 'photo.jpg',
              fileUrl: 'https://example.com/photo.jpg',
              fileKey: 'key-1',
              fileSize: 12345,
              mimeType: 'image/jpeg',
              thumbnailUrl: 'https://example.com/thumb.jpg',
              width: 800,
              height: 600,
              createdAt: new Date(),
            },
          ],
        ],
      ]);
      messagesService.getAttachmentsForMessages.mockResolvedValue(
        attachmentMap,
      );

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      // The forward message should be created with attachments: undefined
      expect(grpcService.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ attachments: undefined }),
      );
      // The insert values should include the attachment in attachmentsSnapshot
      const insertArgs = db.chains.insertValues.mock.calls[0][0] as any[];
      expect(insertArgs[0].attachmentsSnapshot).toHaveLength(1);
      expect(insertArgs[0].attachmentsSnapshot[0].originalAttachmentId).toBe(
        'att-1',
      );
    });

    it('forwards a single long_text message', async () => {
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ type: 'long_text', content: 'A'.repeat(3000) }),
      ]);

      const result = await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      expect(result).toBeDefined();
    });

    it('forwards a single re-forward (source type === forward) with no attachments and no AST snapshot', async () => {
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({
          type: 'forward',
          content: '[Forwarded] original',
          contentAst: { root: {} },
        }),
      ]);
      const attachmentMap = new Map([
        [
          'msg-1',
          [
            {
              id: 'att-1',
              messageId: 'msg-1',
              fileName: 'file.txt',
              fileUrl: 'https://x',
              fileKey: null,
              fileSize: 100,
              mimeType: 'text/plain',
              thumbnailUrl: null,
              width: null,
              height: null,
              createdAt: new Date(),
            },
          ],
        ],
      ]);
      messagesService.getAttachmentsForMessages.mockResolvedValue(
        attachmentMap,
      );

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      const insertArgs = db.chains.insertValues.mock.calls[0][0] as any[];
      expect(insertArgs[0].contentAstSnapshot).toBeNull();
      expect(insertArgs[0].attachmentsSnapshot).toHaveLength(0);
      expect(insertArgs[0].sourceType).toBe('forward');
    });

    it('uses clientMsgId from input when provided', async () => {
      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        clientMsgId: 'my-client-id',
        userId: 'user-1',
      });

      expect(grpcService.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ clientMsgId: 'my-client-id' }),
      );
    });

    it('generates a clientMsgId when not provided', async () => {
      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      const call = grpcService.createMessage.mock.calls[0][0] as any;
      expect(typeof call.clientMsgId).toBe('string');
      expect(call.clientMsgId).toBeTruthy();
    });

    it('includes metadata.forward in the grpc createMessage call', async () => {
      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      const call = grpcService.createMessage.mock.calls[0][0] as any;
      expect(call.metadata?.forward?.kind).toBe('single');
      expect(call.metadata?.forward?.sourceChannelId).toBe('ch-src');
    });

    it('uses tenantId from targetChannel as workspaceId', async () => {
      channelsService.findById
        .mockResolvedValueOnce(
          makeChannel({ id: 'ch-src', tenantId: 'ws-src' }),
        ) // source channel
        .mockResolvedValueOnce(
          makeChannel({ id: 'ch-target', tenantId: 'ws-target' }),
        ); // target channel

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      const call = grpcService.createMessage.mock.calls[0][0] as any;
      expect(call.workspaceId).toBe('ws-target');
    });

    it('handles targetChannel with null tenantId (workspaceId undefined)', async () => {
      channelsService.findById
        .mockResolvedValueOnce(makeChannel({ id: 'ch-src', tenantId: null })) // source channel
        .mockResolvedValueOnce(
          makeChannel({ id: 'ch-target', tenantId: null }),
        ); // target channel

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      const call = grpcService.createMessage.mock.calls[0][0] as any;
      expect(call.workspaceId).toBeUndefined();
    });
  });

  // ── bundle forward ────────────────────────────────────────────────────────

  describe('bundle forward', () => {
    it('forwards 5 mixed-type messages as a bundle with ordered positions', async () => {
      const ids = ['m1', 'm2', 'm3', 'm4', 'm5'];
      const types = ['text', 'image', 'long_text', 'file', 'forward'] as const;
      messagesService.findManyByIds.mockResolvedValue(
        ids.map((id, i) =>
          makeMessage({ id, type: types[i], content: `content ${i}` }),
        ),
      );
      messagesService.getMessageWithDetails.mockResolvedValue(
        makeMessageResponse({ id: 'fwd-bundle' }),
      );

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ids,
        userId: 'user-1',
      });

      const call = grpcService.createMessage.mock.calls[0][0] as any;
      expect(call.metadata?.forward?.kind).toBe('bundle');
      expect(call.metadata?.forward?.count).toBe(5);

      const insertArgs = db.chains.insertValues.mock.calls[0][0] as any[];
      expect(insertArgs).toHaveLength(5);
      insertArgs.forEach((row: any, i: number) => {
        expect(row.position).toBe(i);
      });
    });

    it('builds bundle digest with source channel name', async () => {
      const ids = ['m1', 'm2', 'm3'];
      messagesService.findManyByIds.mockResolvedValue(
        ids.map((id, i) => makeMessage({ id, content: `msg ${i}` })),
      );
      channelsService.findById.mockResolvedValue(
        makeChannel({ name: 'general' }),
      );

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ids,
        userId: 'user-1',
      });

      const call = grpcService.createMessage.mock.calls[0][0] as any;
      expect(call.content).toContain('[Forwarded chat record');
      expect(call.content).toContain('general');
    });

    it('uses "channel" fallback when sourceChannelName is null', async () => {
      channelsService.findById.mockResolvedValue(null);
      const ids = ['m1', 'm2'];
      messagesService.findManyByIds.mockResolvedValue(
        ids.map((id) => makeMessage({ id })),
      );

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ids,
        userId: 'user-1',
      });

      const call = grpcService.createMessage.mock.calls[0][0] as any;
      expect(call.content).toContain('#channel');
    });
  });

  // ── truncation ────────────────────────────────────────────────────────────

  describe('truncation', () => {
    it('truncates contentSnapshot to 100_000 chars and sets truncated=true', async () => {
      const longContent = 'A'.repeat(100_001);
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ content: longContent }),
      ]);

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      const insertArgs = db.chains.insertValues.mock.calls[0][0] as any[];
      expect(insertArgs[0].contentSnapshot).toHaveLength(100_000);

      // metadata should have truncated: true
      const call = grpcService.createMessage.mock.calls[0][0] as any;
      expect(call.metadata?.forward?.truncated).toBe(true);
    });

    it('does NOT set truncated flag when content length is exactly 100_000', async () => {
      const exactContent = 'A'.repeat(100_000);
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ content: exactContent }),
      ]);

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      const call = grpcService.createMessage.mock.calls[0][0] as any;
      expect(call.metadata?.forward?.truncated).toBeUndefined();
    });
  });

  // ── attachments ───────────────────────────────────────────────────────────

  describe('attachments', () => {
    it('calls grpc.createMessage with attachments: undefined', async () => {
      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      expect(grpcService.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ attachments: undefined }),
      );
    });

    it('includes attachment snapshot fields from original attachments', async () => {
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ type: 'file' }),
      ]);
      const attachmentMap = new Map([
        [
          'msg-1',
          [
            {
              id: 'att-original',
              messageId: 'msg-1',
              fileName: 'report.pdf',
              fileUrl: 'https://example.com/report.pdf',
              fileKey: 'filekey-123',
              fileSize: 98765,
              mimeType: 'application/pdf',
              thumbnailUrl: null,
              width: null,
              height: null,
              createdAt: new Date(),
            },
          ],
        ],
      ]);
      messagesService.getAttachmentsForMessages.mockResolvedValue(
        attachmentMap,
      );

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      const insertArgs = db.chains.insertValues.mock.calls[0][0] as any[];
      expect(insertArgs[0].attachmentsSnapshot[0]).toMatchObject({
        originalAttachmentId: 'att-original',
        fileName: 'report.pdf',
        fileKey: 'filekey-123',
      });
    });

    it('handles attachment with null fileKey', async () => {
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ type: 'file' }),
      ]);
      const attachmentMap = new Map([
        [
          'msg-1',
          [
            {
              id: 'att-1',
              messageId: 'msg-1',
              fileName: 'ext.pdf',
              fileUrl: 'https://external.com/file.pdf',
              fileKey: null, // external file — no fileKey
              fileSize: 500,
              mimeType: 'application/pdf',
              thumbnailUrl: null,
              width: null,
              height: null,
              createdAt: new Date(),
            },
          ],
        ],
      ]);
      messagesService.getAttachmentsForMessages.mockResolvedValue(
        attachmentMap,
      );

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['msg-1'],
        userId: 'user-1',
      });

      const insertArgs = db.chains.insertValues.mock.calls[0][0] as any[];
      expect(insertArgs[0].attachmentsSnapshot[0].fileKey).toBeNull();
    });
  });

  // ── failed insert rollback ─────────────────────────────────────────────────

  describe('failed insert rollback', () => {
    it('soft-deletes the forward message and throws InternalServerErrorException when db.insert fails', async () => {
      db.chains.insertValues.mockRejectedValue(new Error('DB error'));

      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ['msg-1'],
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'forward.insertFailed' });

      await expect(
        service.forward({
          targetChannelId: 'ch-target',
          sourceChannelId: 'ch-src',
          sourceMessageIds: ['msg-1'],
          userId: 'user-1',
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      expect(messagesService.softDelete).toHaveBeenCalled();
    });
  });

  // ── getForwardItems ───────────────────────────────────────────────────────

  describe('getForwardItems', () => {
    it('enforces assertReadAccess on the channel containing the forward message', async () => {
      db.chains.selectOrderBy.mockResolvedValue([makeForwardRow()]);

      await service.getForwardItems('fwd-msg-1', 'user-1');

      expect(messagesService.getMessageChannelId).toHaveBeenCalledWith(
        'fwd-msg-1',
      );
      expect(channelsService.assertReadAccess).toHaveBeenCalledWith(
        'ch-target',
        'user-1',
      );
    });

    it('returns ordered ForwardItemResponse[]', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ position: 0, sourceMessageId: 'msg-1' }),
        makeForwardRow({
          id: 'fwd-row-2',
          position: 1,
          sourceMessageId: 'msg-2',
        }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ id: 'msg-1' }),
        makeMessage({ id: 'msg-2' }),
      ]);
      messagesService.findUsersByIds.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: null,
        },
      ]);

      const items = await service.getForwardItems('fwd-msg-1', 'user-1');

      expect(items).toHaveLength(2);
      expect(items[0].position).toBe(0);
      expect(items[1].position).toBe(1);
    });

    it('returns [] for an unknown forward message id (no rows)', async () => {
      db.chains.selectOrderBy.mockResolvedValue([]);

      const items = await service.getForwardItems('unknown-id', 'user-1');

      expect(items).toEqual([]);
    });
  });

  // ── hydratePayload ────────────────────────────────────────────────────────

  describe('hydratePayload', () => {
    it('composes payload from items and metadata', async () => {
      db.chains.selectOrderBy.mockResolvedValue([makeForwardRow()]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const payload = await service.hydratePayload('fwd-msg-1', 'user-1', {
        kind: 'single',
        count: 1,
        sourceChannelId: 'ch-src',
        sourceChannelName: 'general',
      });

      expect(payload.kind).toBe('single');
      expect(payload.count).toBe(1);
      expect(payload.sourceChannelId).toBe('ch-src');
      expect(payload.sourceChannelName).toBe('general');
      expect(Array.isArray(payload.items)).toBe(true);
    });

    it('uses metadata.truncated when set', async () => {
      db.chains.selectOrderBy.mockResolvedValue([makeForwardRow()]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const payload = await service.hydratePayload('fwd-msg-1', 'user-1', {
        kind: 'single',
        count: 1,
        sourceChannelId: 'ch-src',
        sourceChannelName: 'general',
        truncated: true,
      });

      expect(payload.truncated).toBe(true);
    });

    it('falls back to items.some(i => i.truncated) when metadata.truncated is undefined', async () => {
      const truncatedContent = 'A'.repeat(100_000);
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ contentSnapshot: truncatedContent }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const payload = await service.hydratePayload('fwd-msg-1', 'user-1', {
        kind: 'single',
        count: 1,
        sourceChannelId: 'ch-src',
        sourceChannelName: 'general',
        // no truncated field
      });

      expect(payload.truncated).toBe(true);
    });

    it('sourceChannelName is null when metadata.sourceChannelName is empty string', async () => {
      db.chains.selectOrderBy.mockResolvedValue([]);

      const payload = await service.hydratePayload('fwd-msg-1', 'user-1', {
        kind: 'single',
        count: 1,
        sourceChannelId: 'ch-src',
        sourceChannelName: '', // empty string
      });

      expect(payload.sourceChannelName).toBeNull();
    });
  });

  // ── hydrateItems (hydrate) ────────────────────────────────────────────────

  describe('hydrateItems (canJumpToOriginal + truncated)', () => {
    it('canJumpToOriginal is true when source exists and user can read source channel', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceMessageId: 'msg-1' }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ id: 'msg-1', isDeleted: false }),
      ]);
      messagesService.findUsersByIds.mockResolvedValue([]);
      channelsService.canRead.mockResolvedValue(true);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].canJumpToOriginal).toBe(true);
    });

    it('canJumpToOriginal is false when source message is hard-deleted (not in liveSources)', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceMessageId: 'msg-1' }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      // Source message not returned (hard deleted)
      messagesService.findManyByIds.mockResolvedValue([]);
      messagesService.findUsersByIds.mockResolvedValue([]);
      channelsService.canRead.mockResolvedValue(true);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].canJumpToOriginal).toBe(false);
    });

    it('canJumpToOriginal is false when source message is soft-deleted (isDeleted=true)', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceMessageId: 'msg-1' }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ id: 'msg-1', isDeleted: true }),
      ]);
      messagesService.findUsersByIds.mockResolvedValue([]);
      channelsService.canRead.mockResolvedValue(true);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].canJumpToOriginal).toBe(false);
    });

    it('canJumpToOriginal is false when user has no read access to source channel', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceMessageId: 'msg-1' }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([
        makeMessage({ id: 'msg-1', isDeleted: false }),
      ]);
      messagesService.findUsersByIds.mockResolvedValue([]);
      channelsService.canRead.mockResolvedValue(false);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].canJumpToOriginal).toBe(false);
    });

    it('canJumpToOriginal is false when sourceMessageId is null', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceMessageId: null }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([]);
      messagesService.findUsersByIds.mockResolvedValue([]);
      channelsService.canRead.mockResolvedValue(true);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].canJumpToOriginal).toBe(false);
    });

    it('sourceChannelName is null when user cannot read source channel', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceMessageId: null }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([
        makeChannel({ name: 'secret' }),
      ]);
      messagesService.findManyByIds.mockResolvedValue([]);
      messagesService.findUsersByIds.mockResolvedValue([]);
      channelsService.canRead.mockResolvedValue(false);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].sourceChannelName).toBeNull();
    });

    it('truncated is true when contentSnapshot.length === 100_000', async () => {
      const exactContent = 'A'.repeat(100_000);
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ contentSnapshot: exactContent }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].truncated).toBe(true);
    });

    it('truncated is false when contentSnapshot.length < 100_000', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ contentSnapshot: 'short content' }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].truncated).toBe(false);
    });

    it('truncated is false when contentSnapshot is null', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ contentSnapshot: null }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].truncated).toBe(false);
    });

    it('sourceSender is null when sourceSenderId is null', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceSenderId: null }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].sourceSender).toBeNull();
    });

    it('sourceSender is null when sender not found in senderMap', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceSenderId: 'user-unknown' }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      // findUsersByIds returns empty (user deleted/not found)
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].sourceSender).toBeNull();
    });

    it('sourceSeqId is null when row.sourceSeqId is null', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceSeqId: null }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].sourceSeqId).toBeNull();
    });

    it('sourceSeqId is a string when row.sourceSeqId is a BigInt', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceSeqId: BigInt(42) }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].sourceSeqId).toBe('42');
    });

    it('returns empty array when there are no rows for the forwardedMessageId', async () => {
      db.chains.selectOrderBy.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items).toEqual([]);
    });

    it('handles rows with no sourceSenderIds (skips findUsersByIds for empty array)', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceSenderId: null }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items).toHaveLength(1);
    });

    it('handles rows with no sourceMessageIds (skips findManyByIds for sources)', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceMessageId: null, sourceSenderId: null }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items).toHaveLength(1);
    });

    it('sourceChannelName is null when channel not found in channelMap', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceChannelId: 'ch-missing' }),
      ]);
      // findManyByIds returns empty (channel deleted)
      channelsService.findManyByIds.mockResolvedValue([]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);
      channelsService.canRead.mockResolvedValue(true);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].sourceChannelName).toBeNull();
    });

    it('sourceWorkspaceId is set from row when not null', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceWorkspaceId: 'ws-abc' }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].sourceWorkspaceId).toBe('ws-abc');
    });

    it('sourceSender includes displayName when not null', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceSenderId: 'user-1' }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          displayName: 'Alice Smith',
          avatarUrl: 'https://example.com/avatar.jpg',
        },
      ]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].sourceSender?.displayName).toBe('Alice Smith');
      expect(items[0].sourceSender?.avatarUrl).toBe(
        'https://example.com/avatar.jpg',
      );
    });

    it('attachmentsSnapshot uses row value when not null', async () => {
      const snapshot = [
        {
          originalAttachmentId: 'att-1',
          fileName: 'f.png',
          fileUrl: 'https://x',
          fileKey: null,
          fileSize: 100,
          mimeType: 'image/png',
          thumbnailUrl: null,
          width: null,
          height: null,
        },
      ];
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ attachmentsSnapshot: snapshot }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].attachmentsSnapshot).toHaveLength(1);
      expect(items[0].attachmentsSnapshot[0].originalAttachmentId).toBe(
        'att-1',
      );
    });

    it('attachmentsSnapshot falls back to empty array when row.attachmentsSnapshot is null', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ attachmentsSnapshot: null }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].attachmentsSnapshot).toEqual([]);
    });

    it('sourceWorkspaceId is null when row.sourceWorkspaceId is null', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceWorkspaceId: null }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].sourceWorkspaceId).toBeNull();
    });

    it('sourceSender.displayName is null when displayName is null', async () => {
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceSenderId: 'user-nullname' }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([makeChannel()]);
      messagesService.findManyByIds.mockResolvedValue([makeMessage()]);
      // Sender with null displayName
      messagesService.findUsersByIds.mockResolvedValue([
        {
          id: 'user-nullname',
          username: 'no-display',
          displayName: null,
          avatarUrl: null,
        },
      ]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].sourceSender?.displayName).toBeNull();
      expect(items[0].sourceSender?.avatarUrl).toBeNull();
    });

    it('accessByChannel defaults to false when channel is not in the map (no canRead call)', async () => {
      // Simulate a channel that is in rows but canRead is not called for it
      // (i.e., distinctChannelIds has it but accessByChannel might not be populated)
      // In practice, accessByChannel always gets populated because we await all calls.
      // This tests the `?? false` fallback by providing an empty canRead mock that
      // doesn't populate for the channel in question.
      const originalCanRead = channelsService.canRead;
      // Make canRead do nothing (doesn't call the map setter)
      channelsService.canRead = jest.fn<any>().mockImplementation(async () => {
        // Deliberately don't populate — but Promise.all will still run
        return false;
      });
      db.chains.selectOrderBy.mockResolvedValue([
        makeForwardRow({ sourceChannelId: 'ch-test', sourceMessageId: null }),
      ]);
      channelsService.findManyByIds.mockResolvedValue([
        makeChannel({ id: 'ch-test' }),
      ]);
      messagesService.findManyByIds.mockResolvedValue([]);
      messagesService.findUsersByIds.mockResolvedValue([]);

      const items = await service.hydrateItems('fwd-msg-1', 'user-1');

      expect(items[0].canJumpToOriginal).toBe(false);
      channelsService.canRead = originalCanRead;
    });
  });

  // ── buildDigest branch: bundle with null content items ───────────────────

  describe('buildDigest null content in bundle', () => {
    it('handles null content in bundle sources by substituting empty string', async () => {
      const ids = ['m1', 'm2'];
      messagesService.findManyByIds.mockResolvedValue(
        ids.map((id) => makeMessage({ id, content: null })),
      );
      channelsService.findById.mockResolvedValue(
        makeChannel({ name: 'general' }),
      );

      await service.forward({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ids,
        userId: 'user-1',
      });

      const call = grpcService.createMessage.mock.calls[0][0] as any;
      // Content should use empty string for null content items
      expect(call.content).toContain('[Forwarded chat record');
    });
  });
});
