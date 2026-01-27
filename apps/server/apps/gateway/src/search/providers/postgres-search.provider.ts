import { Injectable, Inject } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  sql,
  eq,
  and,
  lt,
  gt,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  SearchProvider,
  SearchQuery,
  SearchResults,
  SearchResultItem,
  MessageSearchResult,
  ChannelSearchResult,
  UserSearchResult,
  FileSearchResult,
  CombinedSearchResults,
} from '../interfaces/index.js';
import { DEFAULT_SEARCH_LIMIT } from '../constants/index.js';

@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async searchMessages(
    query: SearchQuery,
    userId: string,
  ): Promise<SearchResults<MessageSearchResult>> {
    const limit = query.limit || DEFAULT_SEARCH_LIMIT;
    const offset = query.offset || 0;

    if (!query.query || query.query.trim() === '') {
      return { items: [], total: 0, hasMore: false };
    }

    const tsQuery = this.buildTsQuery(query.query);

    // Build dynamic conditions
    const conditions: ReturnType<typeof sql>[] = [
      sql`ms.search_vector @@ to_tsquery('simple', ${tsQuery})`,
    ];

    if (query.tenantId) {
      conditions.push(sql`ms.tenant_id = ${query.tenantId}`);
    }
    if (query.from) {
      conditions.push(sql`ms.sender_username = ${query.from}`);
    }
    if (query.in) {
      conditions.push(sql`ms.channel_name = ${query.in}`);
    }
    if (query.before) {
      conditions.push(sql`ms.message_created_at < ${query.before}`);
    }
    if (query.after) {
      conditions.push(sql`ms.message_created_at > ${query.after}`);
    }
    if (query.hasFile) {
      conditions.push(sql`ms.has_attachment = true`);
    }
    if (query.isPinned) {
      conditions.push(sql`ms.is_pinned = true`);
    }
    if (query.isThread) {
      conditions.push(sql`ms.is_thread_reply = true`);
    }

    const whereClause = sql.join(conditions, sql` AND `);

    const results = await this.db.execute<{
      message_id: string;
      content_snapshot: string | null;
      channel_id: string;
      channel_name: string | null;
      sender_id: string | null;
      sender_username: string | null;
      sender_display_name: string | null;
      message_type: string | null;
      has_attachment: boolean;
      is_pinned: boolean;
      is_thread_reply: boolean;
      message_created_at: Date;
      score: number;
      highlight: string | null;
    }>(sql`
      SELECT
        ms.message_id,
        ms.content_snapshot,
        ms.channel_id,
        ms.channel_name,
        ms.sender_id,
        ms.sender_username,
        ms.sender_display_name,
        ms.message_type,
        ms.has_attachment,
        ms.is_pinned,
        ms.is_thread_reply,
        ms.message_created_at,
        ts_rank(ms.search_vector, to_tsquery('simple', ${tsQuery})) as score,
        ts_headline('simple', ms.content_snapshot, to_tsquery('simple', ${tsQuery}),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20') as highlight
      FROM im_message_search ms
      JOIN im_channel_members cm
        ON ms.channel_id = cm.channel_id
        AND cm.user_id = ${userId}
        AND cm.left_at IS NULL
      WHERE ${whereClause}
      ORDER BY score DESC, ms.message_created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `);

    const hasMore = results.length > limit;
    const items = results.slice(0, limit).map(
      (row): SearchResultItem<MessageSearchResult> => ({
        id: row.message_id,
        type: 'message',
        score: Number(row.score),
        highlight: row.highlight || undefined,
        data: {
          id: row.message_id,
          channelId: row.channel_id,
          channelName: row.channel_name,
          senderId: row.sender_id,
          senderUsername: row.sender_username,
          senderDisplayName: row.sender_display_name,
          content: row.content_snapshot,
          messageType: row.message_type,
          hasAttachment: row.has_attachment,
          isPinned: row.is_pinned,
          isThreadReply: row.is_thread_reply,
          createdAt: row.message_created_at,
        },
      }),
    );

    return {
      items,
      total: items.length,
      hasMore,
    };
  }

  async searchChannels(
    query: SearchQuery,
    userId: string,
  ): Promise<SearchResults<ChannelSearchResult>> {
    const limit = query.limit || DEFAULT_SEARCH_LIMIT;
    const offset = query.offset || 0;

    if (!query.query || query.query.trim() === '') {
      return { items: [], total: 0, hasMore: false };
    }

    const tsQuery = this.buildTsQuery(query.query);

    const conditions: ReturnType<typeof sql>[] = [
      sql`cs.search_vector @@ to_tsquery('simple', ${tsQuery})`,
    ];

    if (query.tenantId) {
      conditions.push(sql`cs.tenant_id = ${query.tenantId}`);
    }

    const whereClause = sql.join(conditions, sql` AND `);

    const results = await this.db.execute<{
      channel_id: string;
      name: string | null;
      description: string | null;
      channel_type: string | null;
      member_count: number;
      is_archived: boolean;
      tenant_id: string | null;
      channel_created_at: Date;
      score: number;
      highlight: string | null;
    }>(sql`
      SELECT
        cs.channel_id,
        cs.name,
        cs.description,
        cs.channel_type,
        cs.member_count,
        cs.is_archived,
        cs.tenant_id,
        cs.channel_created_at,
        ts_rank(cs.search_vector, to_tsquery('simple', ${tsQuery})) as score,
        ts_headline('simple', cs.name, to_tsquery('simple', ${tsQuery}),
          'StartSel=<mark>, StopSel=</mark>') as highlight
      FROM im_channel_search cs
      WHERE ${whereClause}
        AND cs.is_archived = false
      ORDER BY score DESC, cs.member_count DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `);

    const hasMore = results.length > limit;
    const items = results.slice(0, limit).map(
      (row): SearchResultItem<ChannelSearchResult> => ({
        id: row.channel_id,
        type: 'channel',
        score: Number(row.score),
        highlight: row.highlight || undefined,
        data: {
          id: row.channel_id,
          name: row.name,
          description: row.description,
          channelType: row.channel_type,
          memberCount: row.member_count,
          isArchived: row.is_archived,
          tenantId: row.tenant_id,
          createdAt: row.channel_created_at,
        },
      }),
    );

    return {
      items,
      total: items.length,
      hasMore,
    };
  }

  async searchUsers(
    query: SearchQuery,
    _userId: string,
  ): Promise<SearchResults<UserSearchResult>> {
    const limit = query.limit || DEFAULT_SEARCH_LIMIT;
    const offset = query.offset || 0;

    if (!query.query || query.query.trim() === '') {
      return { items: [], total: 0, hasMore: false };
    }

    const tsQuery = this.buildTsQuery(query.query);

    const results = await this.db.execute<{
      user_id: string;
      username: string | null;
      display_name: string | null;
      email: string | null;
      status: string | null;
      is_active: boolean;
      user_created_at: Date;
      score: number;
      highlight: string | null;
    }>(sql`
      SELECT
        us.user_id,
        us.username,
        us.display_name,
        us.email,
        us.status,
        us.is_active,
        us.user_created_at,
        ts_rank(us.search_vector, to_tsquery('simple', ${tsQuery})) as score,
        ts_headline('simple', COALESCE(us.display_name, us.username), to_tsquery('simple', ${tsQuery}),
          'StartSel=<mark>, StopSel=</mark>') as highlight
      FROM im_user_search us
      WHERE us.search_vector @@ to_tsquery('simple', ${tsQuery})
        AND us.is_active = true
      ORDER BY score DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `);

    const hasMore = results.length > limit;
    const items = results.slice(0, limit).map(
      (row): SearchResultItem<UserSearchResult> => ({
        id: row.user_id,
        type: 'user',
        score: Number(row.score),
        highlight: row.highlight || undefined,
        data: {
          id: row.user_id,
          username: row.username,
          displayName: row.display_name,
          email: row.email,
          status: row.status,
          isActive: row.is_active,
          createdAt: row.user_created_at,
        },
      }),
    );

    return {
      items,
      total: items.length,
      hasMore,
    };
  }

  async searchFiles(
    query: SearchQuery,
    userId: string,
  ): Promise<SearchResults<FileSearchResult>> {
    const limit = query.limit || DEFAULT_SEARCH_LIMIT;
    const offset = query.offset || 0;

    if (!query.query || query.query.trim() === '') {
      return { items: [], total: 0, hasMore: false };
    }

    const tsQuery = this.buildTsQuery(query.query);

    const conditions: ReturnType<typeof sql>[] = [
      sql`fs.search_vector @@ to_tsquery('simple', ${tsQuery})`,
    ];

    if (query.tenantId) {
      conditions.push(sql`fs.tenant_id = ${query.tenantId}`);
    }
    if (query.in) {
      conditions.push(sql`fs.channel_name = ${query.in}`);
    }

    const whereClause = sql.join(conditions, sql` AND `);

    const results = await this.db.execute<{
      file_id: string;
      file_name: string | null;
      mime_type: string | null;
      file_size: number | null;
      channel_id: string | null;
      channel_name: string | null;
      uploader_id: string | null;
      uploader_username: string | null;
      file_created_at: Date;
      score: number;
      highlight: string | null;
    }>(sql`
      SELECT
        fs.file_id,
        fs.file_name,
        fs.mime_type,
        fs.file_size,
        fs.channel_id,
        fs.channel_name,
        fs.uploader_id,
        fs.uploader_username,
        fs.file_created_at,
        ts_rank(fs.search_vector, to_tsquery('simple', ${tsQuery})) as score,
        ts_headline('simple', fs.file_name, to_tsquery('simple', ${tsQuery}),
          'StartSel=<mark>, StopSel=</mark>') as highlight
      FROM im_file_search fs
      LEFT JOIN im_channel_members cm
        ON fs.channel_id = cm.channel_id
        AND cm.user_id = ${userId}
        AND cm.left_at IS NULL
      WHERE ${whereClause}
        AND (fs.channel_id IS NULL OR cm.user_id IS NOT NULL)
      ORDER BY score DESC, fs.file_created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `);

    const hasMore = results.length > limit;
    const items = results.slice(0, limit).map(
      (row): SearchResultItem<FileSearchResult> => ({
        id: row.file_id,
        type: 'file',
        score: Number(row.score),
        highlight: row.highlight || undefined,
        data: {
          id: row.file_id,
          fileName: row.file_name,
          mimeType: row.mime_type,
          fileSize: row.file_size,
          channelId: row.channel_id,
          channelName: row.channel_name,
          uploaderId: row.uploader_id,
          uploaderUsername: row.uploader_username,
          createdAt: row.file_created_at,
        },
      }),
    );

    return {
      items,
      total: items.length,
      hasMore,
    };
  }

  async searchAll(
    query: SearchQuery,
    userId: string,
  ): Promise<CombinedSearchResults> {
    // Run all searches in parallel
    const [messages, channels, users, files] = await Promise.all([
      this.searchMessages({ ...query, limit: 5 }, userId),
      this.searchChannels({ ...query, limit: 5 }, userId),
      this.searchUsers({ ...query, limit: 5 }, userId),
      this.searchFiles({ ...query, limit: 5 }, userId),
    ]);

    return {
      messages,
      channels,
      users,
      files,
    };
  }

  /**
   * Convert user query to PostgreSQL tsquery format
   * Handles phrases and multiple terms
   */
  private buildTsQuery(query: string): string {
    // Clean the query and split into terms
    const terms = query
      .trim()
      .split(/\s+/)
      .filter((term) => term.length > 0)
      .map((term) => term.replace(/[^\w\u4e00-\u9fff]/g, '')); // Keep alphanumeric and Chinese chars

    if (terms.length === 0) {
      return '';
    }

    // Join with & for AND logic, add :* for prefix matching
    return terms.map((term) => `${term}:*`).join(' & ');
  }
}
