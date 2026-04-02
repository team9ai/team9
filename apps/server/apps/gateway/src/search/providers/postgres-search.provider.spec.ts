import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockJoin = jest.fn((parts: unknown[], separator: unknown) => ({
  kind: 'join',
  parts,
  separator,
}));
const mockSql = Object.assign(
  jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    text: strings.join('::slot::'),
    values,
  })),
  {
    join: mockJoin,
  },
);

jest.unstable_mockModule('@team9/database', () => ({
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  sql: mockSql,
}));

jest.unstable_mockModule('@team9/database/schemas', () => ({}));

const { PostgresSearchProvider } =
  await import('./postgres-search.provider.js');

function createDbMock() {
  return {
    execute: jest.fn<any>(),
  };
}

describe('PostgresSearchProvider', () => {
  let db: ReturnType<typeof createDbMock>;
  let provider: InstanceType<typeof PostgresSearchProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDbMock();
    provider = new PostgresSearchProvider(db as never);
  });

  it('short-circuits blank queries for all search endpoints', async () => {
    await expect(
      provider.searchMessages({ query: '   ' } as never, 'user-1'),
    ).resolves.toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
    await expect(
      provider.searchChannels({ query: '' } as never, 'user-1'),
    ).resolves.toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
    await expect(
      provider.searchUsers({ query: ' ' } as never, 'user-1'),
    ).resolves.toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
    await expect(
      provider.searchFiles({ query: '\n\t' } as never, 'user-1'),
    ).resolves.toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('builds filtered message queries and maps paginated results', async () => {
    const before = new Date('2026-04-02T10:00:00.000Z');
    const after = new Date('2026-04-01T10:00:00.000Z');
    db.execute.mockResolvedValueOnce([
      {
        message_id: 'msg-1',
        content_snapshot: 'hello world',
        channel_id: 'channel-1',
        channel_name: 'general',
        sender_id: 'user-1',
        sender_username: 'alice',
        sender_display_name: 'Alice',
        message_type: 'text',
        has_attachment: true,
        is_pinned: true,
        is_thread_reply: false,
        message_created_at: new Date('2026-04-02T11:00:00.000Z'),
        score: 0.9,
        highlight: '<mark>hello</mark> world',
      },
      {
        message_id: 'msg-2',
        content_snapshot: 'extra',
        channel_id: 'channel-2',
        channel_name: 'random',
        sender_id: 'user-2',
        sender_username: 'bob',
        sender_display_name: 'Bob',
        message_type: 'text',
        has_attachment: false,
        is_pinned: false,
        is_thread_reply: true,
        message_created_at: new Date('2026-04-01T11:00:00.000Z'),
        score: 0.5,
        highlight: null,
      },
    ]);

    await expect(
      provider.searchMessages(
        {
          query: 'Hello World',
          limit: 1,
          offset: 3,
          tenantId: 'tenant-1',
          from: 'alice',
          in: 'general',
          before,
          after,
          hasFile: true,
          isPinned: true,
          isThread: true,
        } as never,
        'user-1',
      ),
    ).resolves.toEqual({
      items: [
        {
          id: 'msg-1',
          type: 'message',
          score: 0.9,
          highlight: '<mark>hello</mark> world',
          data: {
            id: 'msg-1',
            channelId: 'channel-1',
            channelName: 'general',
            senderId: 'user-1',
            senderUsername: 'alice',
            senderDisplayName: 'Alice',
            content: 'hello world',
            messageType: 'text',
            hasAttachment: true,
            isPinned: true,
            isThreadReply: false,
            createdAt: new Date('2026-04-02T11:00:00.000Z'),
          },
        },
      ],
      total: 1,
      hasMore: true,
    });

    expect(mockJoin).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'sql' }),
        expect.objectContaining({ kind: 'sql' }),
      ]),
      expect.objectContaining({ kind: 'sql' }),
    );
    expect(mockJoin.mock.calls[0][0]).toHaveLength(9);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('maps channel results and respects pagination', async () => {
    db.execute.mockResolvedValueOnce([
      {
        channel_id: 'channel-1',
        name: 'general',
        description: 'team chat',
        channel_type: 'public',
        member_count: 8,
        is_archived: false,
        tenant_id: 'tenant-1',
        channel_created_at: new Date('2026-04-02T10:00:00.000Z'),
        score: 1.2,
        highlight: '<mark>general</mark>',
      },
      {
        channel_id: 'channel-2',
        name: 'random',
        description: null,
        channel_type: 'public',
        member_count: 3,
        is_archived: false,
        tenant_id: 'tenant-1',
        channel_created_at: new Date('2026-04-01T10:00:00.000Z'),
        score: 0.6,
        highlight: null,
      },
    ]);

    await expect(
      provider.searchChannels(
        { query: 'general', limit: 1, tenantId: 'tenant-1' } as never,
        'user-1',
      ),
    ).resolves.toEqual({
      items: [
        {
          id: 'channel-1',
          type: 'channel',
          score: 1.2,
          highlight: '<mark>general</mark>',
          data: {
            id: 'channel-1',
            name: 'general',
            description: 'team chat',
            channelType: 'public',
            memberCount: 8,
            isArchived: false,
            tenantId: 'tenant-1',
            createdAt: new Date('2026-04-02T10:00:00.000Z'),
          },
        },
      ],
      total: 1,
      hasMore: true,
    });
  });

  it('maps user results and executes the tenant-joined search path', async () => {
    db.execute.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        username: 'alice',
        display_name: 'Alice',
        email: 'alice@example.com',
        status: 'online',
        is_active: true,
        user_created_at: new Date('2026-04-02T10:00:00.000Z'),
        score: 0.8,
        highlight: '<mark>Alice</mark>',
      },
    ]);

    await expect(
      provider.searchUsers(
        { query: 'alice', tenantId: 'tenant-1' } as never,
        'user-1',
      ),
    ).resolves.toEqual({
      items: [
        {
          id: 'user-1',
          type: 'user',
          score: 0.8,
          highlight: '<mark>Alice</mark>',
          data: {
            id: 'user-1',
            username: 'alice',
            displayName: 'Alice',
            email: 'alice@example.com',
            status: 'online',
            isActive: true,
            createdAt: new Date('2026-04-02T10:00:00.000Z'),
          },
        },
      ],
      total: 1,
      hasMore: false,
    });

    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'sql',
      }),
    );
  });

  it('maps file results and enforces channel visibility join logic', async () => {
    db.execute.mockResolvedValueOnce([
      {
        file_id: 'file-1',
        file_name: 'design.pdf',
        mime_type: 'application/pdf',
        file_size: 1024,
        channel_id: 'channel-1',
        channel_name: 'docs',
        uploader_id: 'user-1',
        uploader_username: 'alice',
        file_created_at: new Date('2026-04-02T10:00:00.000Z'),
        score: 0.7,
        highlight: '<mark>design</mark>.pdf',
      },
    ]);

    await expect(
      provider.searchFiles(
        { query: 'design', tenantId: 'tenant-1', in: 'docs' } as never,
        'user-1',
      ),
    ).resolves.toEqual({
      items: [
        {
          id: 'file-1',
          type: 'file',
          score: 0.7,
          highlight: '<mark>design</mark>.pdf',
          data: {
            id: 'file-1',
            fileName: 'design.pdf',
            mimeType: 'application/pdf',
            fileSize: 1024,
            channelId: 'channel-1',
            channelName: 'docs',
            uploaderId: 'user-1',
            uploaderUsername: 'alice',
            createdAt: new Date('2026-04-02T10:00:00.000Z'),
          },
        },
      ],
      total: 1,
      hasMore: false,
    });
  });

  it('runs all four searches in parallel with a fixed limit of five', async () => {
    const messages = { items: [], total: 0, hasMore: false };
    const channels = { items: [], total: 0, hasMore: false };
    const users = { items: [], total: 0, hasMore: false };
    const files = { items: [], total: 0, hasMore: false };
    const searchMessages = jest
      .spyOn(provider, 'searchMessages')
      .mockResolvedValue(messages as never);
    const searchChannels = jest
      .spyOn(provider, 'searchChannels')
      .mockResolvedValue(channels as never);
    const searchUsers = jest
      .spyOn(provider, 'searchUsers')
      .mockResolvedValue(users as never);
    const searchFiles = jest
      .spyOn(provider, 'searchFiles')
      .mockResolvedValue(files as never);

    await expect(
      provider.searchAll({ query: 'hello', offset: 2 } as never, 'user-1'),
    ).resolves.toEqual({
      messages,
      channels,
      users,
      files,
    });

    expect(searchMessages).toHaveBeenCalledWith(
      { query: 'hello', offset: 2, limit: 5 },
      'user-1',
    );
    expect(searchChannels).toHaveBeenCalledWith(
      { query: 'hello', offset: 2, limit: 5 },
      'user-1',
    );
    expect(searchUsers).toHaveBeenCalledWith(
      { query: 'hello', offset: 2, limit: 5 },
      'user-1',
    );
    expect(searchFiles).toHaveBeenCalledWith(
      { query: 'hello', offset: 2, limit: 5 },
      'user-1',
    );
  });

  it('sanitizes and tokenizes search text for tsquery', () => {
    expect((provider as any).buildTsQuery('  Hello, 世界!! team-9  ')).toBe(
      'hello:* & 世界:* & team9:*',
    );
    expect((provider as any).buildTsQuery('!!!')).toBe('');
  });
});
