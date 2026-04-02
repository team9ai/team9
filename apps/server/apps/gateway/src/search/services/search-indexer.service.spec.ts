import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockEq = jest.fn((left: unknown, right: unknown) => ({
  kind: 'eq',
  left,
  right,
}));
const mockAnd = jest.fn((...clauses: unknown[]) => ({
  kind: 'and',
  clauses,
}));
const mockSql = jest.fn(
  (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    text: String.raw(strings, ...values.map((value) => String(value))),
    values,
  }),
);

const schemaModule = {
  messageSearch: {
    messageId: 'messageSearch.messageId',
    searchVector: 'messageSearch.searchVector',
  },
  channelSearch: {
    channelId: 'channelSearch.channelId',
    searchVector: 'channelSearch.searchVector',
  },
  userSearch: {
    userId: 'userSearch.userId',
    searchVector: 'userSearch.searchVector',
  },
  fileSearch: {
    fileId: 'fileSearch.fileId',
    searchVector: 'fileSearch.searchVector',
  },
  messageAttachments: {
    messageId: 'messageAttachments.messageId',
  },
  channelMembers: {
    channelId: 'channelMembers.channelId',
    leftAt: 'channelMembers.leftAt',
  },
  messages: {
    id: 'messages.id',
    isDeleted: 'messages.isDeleted',
    channelId: 'messages.channelId',
    senderId: 'messages.senderId',
  },
  channels: {
    id: 'channels.id',
  },
  users: {
    id: 'users.id',
  },
  files: {
    id: 'files.id',
  },
};

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: mockEq,
  and: mockAnd,
  sql: mockSql,
}));

jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);

const { SearchIndexerService } = await import('./search-indexer.service.js');
const schema = await import('@team9/database/schemas');

type MockFn = jest.Mock<(...args: any[]) => any>;

function createQueryMock() {
  const query = {
    values: jest.fn<any>().mockReturnThis(),
    onConflictDoUpdate: jest.fn<any>().mockResolvedValue(undefined),
    where: jest.fn<any>().mockResolvedValue(undefined),
    from: jest.fn<any>().mockReturnThis(),
    limit: jest.fn<any>().mockReturnThis(),
    offset: jest.fn<any>().mockReturnThis(),
  };

  return query;
}

function createDbMock() {
  const state = {
    selectResults: [] as unknown[][],
    insertReject: null as Error | null,
    deleteReject: null as Error | null,
  };

  const db: any = {
    select: jest.fn(() => {
      const query = createQueryMock();
      query.where.mockImplementation(() =>
        Promise.resolve(state.selectResults.shift() ?? []),
      );
      return query;
    }),
    insert: jest.fn(() => {
      const query = createQueryMock();
      if (state.insertReject) {
        query.onConflictDoUpdate.mockRejectedValue(state.insertReject);
      }
      db.insertChain = query;
      return query;
    }),
    delete: jest.fn(() => {
      const query = createQueryMock();
      if (state.deleteReject) {
        query.where.mockRejectedValue(state.deleteReject);
      }
      db.deleteChain = query;
      return query;
    }),
    insertChain: null as ReturnType<typeof createQueryMock> | null,
    deleteChain: null as ReturnType<typeof createQueryMock> | null,
  };

  return { db, state };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    content: 'Hello WORLD',
    channelId: 'channel-1',
    senderId: 'user-1',
    type: 'text',
    parentId: null,
    isPinned: false,
    createdAt: new Date('2026-04-02T10:30:00.000Z'),
    ...overrides,
  };
}

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'channel-1',
    name: 'General',
    description: 'Team Updates',
    type: 'public',
    isArchived: false,
    tenantId: 'tenant-1',
    createdAt: new Date('2026-04-02T10:30:00.000Z'),
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    username: 'alice',
    displayName: 'Alice A.',
    email: 'alice@example.com',
    status: 'online',
    isActive: true,
    createdAt: new Date('2026-04-02T10:30:00.000Z'),
    ...overrides,
  };
}

function makeFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    fileName: 'Design Doc.pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    channelId: 'channel-1',
    uploaderId: 'user-1',
    tenantId: 'tenant-1',
    createdAt: new Date('2026-04-02T10:30:00.000Z'),
    ...overrides,
  };
}

describe('SearchIndexerService', () => {
  let service: InstanceType<typeof SearchIndexerService>;
  let db: ReturnType<typeof createDbMock>;
  let logger: {
    error: MockFn;
    log: MockFn;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDbMock();
    service = new SearchIndexerService(db.db as never);
    logger = {
      error: jest.fn<any>(),
      log: jest.fn<any>(),
    };
    (service as any).logger = logger;
  });

  describe('indexMessage / removeMessageIndex', () => {
    it('indexes a message and records attachment presence', async () => {
      db.state.selectResults = [[{ count: 1 }]];

      const message = makeMessage({ content: 'Hello WORLD' });
      const channel = makeChannel();
      const sender = makeUser({ username: 'alice', displayName: 'Alice' });

      await service.indexMessage(message as any, channel as any, sender as any);

      expect(db.db.select).toHaveBeenCalledWith({
        count: expect.any(Object),
      });
      expect(db.db.insert).toHaveBeenCalledWith(schema.messageSearch);
      expect(db.db.insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'message-1',
          contentSnapshot: 'Hello WORLD',
          channelId: 'channel-1',
          channelName: 'General',
          senderId: 'user-1',
          senderUsername: 'alice',
          senderDisplayName: 'Alice',
          messageType: 'text',
          hasAttachment: true,
          isPinned: false,
          isThreadReply: false,
          tenantId: 'tenant-1',
          messageCreatedAt: message.createdAt,
        }),
      );
      expect(db.db.insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: schema.messageSearch.messageId,
          set: expect.objectContaining({
            contentSnapshot: 'Hello WORLD',
            hasAttachment: true,
            updatedAt: expect.any(Date),
          }),
        }),
      );
      expect(mockSql).toHaveBeenCalledWith(expect.any(Array), 'hello world');
    });

    it('removes a message index', async () => {
      await service.removeMessageIndex('message-1');

      expect(db.db.delete).toHaveBeenCalledWith(schema.messageSearch);
      expect(db.db.deleteChain.where).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'eq',
          left: schema.messageSearch.messageId,
          right: 'message-1',
        }),
      );
    });
  });

  describe('indexChannel / removeChannelIndex', () => {
    it('indexes a channel and falls back to a zero member count when none are returned', async () => {
      db.state.selectResults = [[[]]];

      const channel = makeChannel();

      await service.indexChannel(channel as any);

      expect(db.db.select).toHaveBeenCalledWith({
        count: expect.any(Object),
      });
      expect(db.db.insert).toHaveBeenCalledWith(schema.channelSearch);
      expect(db.db.insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-1',
          name: 'General',
          description: 'Team Updates',
          channelType: 'public',
          memberCount: 0,
          isArchived: false,
          tenantId: 'tenant-1',
          channelCreatedAt: channel.createdAt,
        }),
      );
    });

    it('removes a channel index', async () => {
      await service.removeChannelIndex('channel-1');

      expect(db.db.delete).toHaveBeenCalledWith(schema.channelSearch);
      expect(db.db.deleteChain.where).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'eq',
          left: schema.channelSearch.channelId,
          right: 'channel-1',
        }),
      );
    });
  });

  describe('indexUser / removeUserIndex', () => {
    it('indexes a user', async () => {
      const user = makeUser();

      await service.indexUser(user as any);

      expect(db.db.insert).toHaveBeenCalledWith(schema.userSearch);
      expect(db.db.insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          username: 'alice',
          displayName: 'Alice A.',
          email: 'alice@example.com',
          status: 'online',
          isActive: true,
          userCreatedAt: user.createdAt,
        }),
      );
      expect(db.db.insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: schema.userSearch.userId,
          set: expect.objectContaining({
            updatedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('removes a user index', async () => {
      await service.removeUserIndex('user-1');

      expect(db.db.delete).toHaveBeenCalledWith(schema.userSearch);
      expect(db.db.deleteChain.where).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'eq',
          left: schema.userSearch.userId,
          right: 'user-1',
        }),
      );
    });
  });

  describe('indexFile / removeFileIndex', () => {
    it('indexes a file and includes channel/uploader context when provided', async () => {
      const file = makeFile();
      const channel = makeChannel({ name: 'Docs' });
      const uploader = makeUser({ username: 'carol' });

      await service.indexFile(file as any, channel as any, uploader as any);

      expect(db.db.insert).toHaveBeenCalledWith(schema.fileSearch);
      expect(db.db.insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'file-1',
          fileName: 'Design Doc.pdf',
          mimeType: 'application/pdf',
          fileSize: 1024,
          channelId: 'channel-1',
          channelName: 'Docs',
          uploaderId: 'user-1',
          uploaderUsername: 'carol',
          tenantId: 'tenant-1',
          fileCreatedAt: file.createdAt,
        }),
      );
      expect(db.db.insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: schema.fileSearch.fileId,
          set: expect.objectContaining({
            channelName: 'Docs',
            updatedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('removes a file index', async () => {
      await service.removeFileIndex('file-1');

      expect(db.db.delete).toHaveBeenCalledWith(schema.fileSearch);
      expect(db.db.deleteChain.where).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'eq',
          left: schema.fileSearch.fileId,
          right: 'file-1',
        }),
      );
    });
  });

  describe('event handlers', () => {
    it('delegates message handlers to message index methods', async () => {
      const indexMessage = jest
        .spyOn(service, 'indexMessage')
        .mockResolvedValue(undefined);
      const removeMessageIndex = jest
        .spyOn(service, 'removeMessageIndex')
        .mockResolvedValue(undefined);
      const payload = {
        message: makeMessage(),
        channel: makeChannel(),
        sender: makeUser(),
      } as any;

      await service.handleMessageCreated(payload);
      await service.handleMessageUpdated(payload);
      await service.handleMessageDeleted('message-1');

      expect(indexMessage).toHaveBeenCalledTimes(2);
      expect(indexMessage).toHaveBeenNthCalledWith(
        1,
        payload.message,
        payload.channel,
        payload.sender,
      );
      expect(removeMessageIndex).toHaveBeenCalledWith('message-1');
    });

    it('delegates channel handlers to channel index methods', async () => {
      const indexChannel = jest
        .spyOn(service, 'indexChannel')
        .mockResolvedValue(undefined);
      const removeChannelIndex = jest
        .spyOn(service, 'removeChannelIndex')
        .mockResolvedValue(undefined);
      const payload = { channel: makeChannel() } as any;

      await service.handleChannelCreated(payload);
      await service.handleChannelUpdated(payload);
      await service.handleChannelDeleted('channel-1');

      expect(indexChannel).toHaveBeenCalledTimes(2);
      expect(indexChannel).toHaveBeenNthCalledWith(1, payload.channel);
      expect(removeChannelIndex).toHaveBeenCalledWith('channel-1');
    });

    it('delegates user handlers to user index methods', async () => {
      const indexUser = jest
        .spyOn(service, 'indexUser')
        .mockResolvedValue(undefined);
      const payload = { user: makeUser() } as any;

      await service.handleUserCreated(payload);
      await service.handleUserUpdated(payload);

      expect(indexUser).toHaveBeenCalledTimes(2);
      expect(indexUser).toHaveBeenNthCalledWith(1, payload.user);
    });

    it('delegates file handlers to file index methods', async () => {
      const indexFile = jest
        .spyOn(service, 'indexFile')
        .mockResolvedValue(undefined);
      const removeFileIndex = jest
        .spyOn(service, 'removeFileIndex')
        .mockResolvedValue(undefined);
      const payload = {
        file: makeFile(),
        channel: makeChannel(),
        uploader: makeUser(),
      } as any;

      await service.handleFileCreated(payload);
      await service.handleFileDeleted('file-1');

      expect(indexFile).toHaveBeenCalledWith(
        payload.file,
        payload.channel,
        payload.uploader,
      );
      expect(removeFileIndex).toHaveBeenCalledWith('file-1');
    });
  });

  describe('helper methods', () => {
    it('returns true when message attachments exist and false when none are found', async () => {
      db.state.selectResults = [[{ count: 2 }], []];

      await expect(
        (service as any).checkHasAttachment('message-1'),
      ).resolves.toBe(true);
      await expect(
        (service as any).checkHasAttachment('message-2'),
      ).resolves.toBe(false);
    });

    it('returns the member count and falls back to zero on empty results', async () => {
      db.state.selectResults = [[{ count: 5 }], []];

      await expect(
        (service as any).getChannelMemberCount('channel-1'),
      ).resolves.toBe(5);
      await expect(
        (service as any).getChannelMemberCount('channel-2'),
      ).resolves.toBe(0);
    });
  });

  describe('error handling', () => {
    it.each([
      [
        'message',
        () => service.indexMessage(makeMessage() as any, makeChannel() as any),
      ],
      ['channel', () => service.indexChannel(makeChannel() as any)],
      ['user', () => service.indexUser(makeUser() as any)],
      ['file', () => service.indexFile(makeFile() as any)],
    ])(
      'swallows insert failures while logging for %s indexing',
      async (_, action) => {
        db.state.insertReject = new Error('insert failed');

        await expect(action()).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to index'),
          db.state.insertReject,
        );
      },
    );

    it.each([
      ['message', () => service.removeMessageIndex('message-1')],
      ['channel', () => service.removeChannelIndex('channel-1')],
      ['user', () => service.removeUserIndex('user-1')],
      ['file', () => service.removeFileIndex('file-1')],
    ])(
      'swallows delete failures while logging for %s removal',
      async (_, action) => {
        db.state.deleteReject = new Error('delete failed');

        await expect(action()).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to remove'),
          db.state.deleteReject,
        );
      },
    );
  });

  describe('bulk reindexing', () => {
    function createBatchQuery<T>(rows: T[]) {
      return {
        from: jest.fn<any>().mockReturnThis(),
        where: jest.fn<any>().mockReturnThis(),
        limit: jest.fn<any>().mockReturnThis(),
        offset: jest.fn<any>().mockResolvedValue(rows),
      };
    }

    function createLookupQuery<T>(rows: T[]) {
      return {
        from: jest.fn<any>().mockReturnThis(),
        where: jest.fn<any>().mockReturnThis(),
        limit: jest.fn<any>().mockResolvedValue(rows),
      };
    }

    it('reindexes messages in batches and resolves related channel/sender lookups', async () => {
      const message = makeMessage();
      const channel = makeChannel();
      const sender = makeUser();
      const indexMessage = jest
        .spyOn(service, 'indexMessage')
        .mockResolvedValue(undefined);

      db.db.select
        .mockReturnValueOnce(createBatchQuery([message]))
        .mockReturnValueOnce(createLookupQuery([channel]))
        .mockReturnValueOnce(createLookupQuery([sender]))
        .mockReturnValueOnce(createBatchQuery([]));

      await service.reindexAllMessages();

      expect(indexMessage).toHaveBeenCalledWith(message, channel, sender);
      expect(logger.log).toHaveBeenCalledWith('Starting message reindexing...');
      expect(logger.log).toHaveBeenCalledWith('Indexed 1 messages...');
      expect(logger.log).toHaveBeenCalledWith(
        'Message reindexing completed. Total: 1',
      );
    });

    it('reindexes channels and users directly from their full-table selects', async () => {
      const indexChannel = jest
        .spyOn(service, 'indexChannel')
        .mockResolvedValue(undefined);
      const indexUser = jest
        .spyOn(service, 'indexUser')
        .mockResolvedValue(undefined);

      db.db.select
        .mockReturnValueOnce({
          from: jest.fn<any>().mockResolvedValue([makeChannel()]),
        })
        .mockReturnValueOnce({
          from: jest.fn<any>().mockResolvedValue([makeUser()]),
        });

      await service.reindexAllChannels();
      await service.reindexAllUsers();

      expect(indexChannel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'channel-1' }),
      );
      expect(indexUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
      );
      expect(logger.log).toHaveBeenCalledWith('Starting channel reindexing...');
      expect(logger.log).toHaveBeenCalledWith(
        'Channel reindexing completed. Total: 1',
      );
      expect(logger.log).toHaveBeenCalledWith('Starting user reindexing...');
      expect(logger.log).toHaveBeenCalledWith(
        'User reindexing completed. Total: 1',
      );
    });

    it('reindexes files in batches with optional channel and uploader lookups', async () => {
      const file = makeFile();
      const channel = makeChannel();
      const uploader = makeUser();
      const indexFile = jest
        .spyOn(service, 'indexFile')
        .mockResolvedValue(undefined);

      db.db.select
        .mockReturnValueOnce(createBatchQuery([file]))
        .mockReturnValueOnce(createLookupQuery([channel]))
        .mockReturnValueOnce(createLookupQuery([uploader]))
        .mockReturnValueOnce(createBatchQuery([]));

      await service.reindexAllFiles();

      expect(indexFile).toHaveBeenCalledWith(file, channel, uploader);
      expect(logger.log).toHaveBeenCalledWith('Starting file reindexing...');
      expect(logger.log).toHaveBeenCalledWith('Indexed 1 files...');
      expect(logger.log).toHaveBeenCalledWith(
        'File reindexing completed. Total: 1',
      );
    });

    it('runs the full reindex pipeline in order', async () => {
      const reindexUsers = jest
        .spyOn(service, 'reindexAllUsers')
        .mockResolvedValue(undefined);
      const reindexChannels = jest
        .spyOn(service, 'reindexAllChannels')
        .mockResolvedValue(undefined);
      const reindexMessages = jest
        .spyOn(service, 'reindexAllMessages')
        .mockResolvedValue(undefined);
      const reindexFiles = jest
        .spyOn(service, 'reindexAllFiles')
        .mockResolvedValue(undefined);

      await service.reindexAll();

      expect(reindexUsers.mock.invocationCallOrder[0]).toBeLessThan(
        reindexChannels.mock.invocationCallOrder[0],
      );
      expect(reindexChannels.mock.invocationCallOrder[0]).toBeLessThan(
        reindexMessages.mock.invocationCallOrder[0],
      );
      expect(reindexMessages.mock.invocationCallOrder[0]).toBeLessThan(
        reindexFiles.mock.invocationCallOrder[0],
      );
    });
  });
});
