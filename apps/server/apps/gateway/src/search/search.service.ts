import { Injectable, Inject } from '@nestjs/common';
import { RedisService } from '@team9/redis';
import { createHash } from 'crypto';
import type {
  SearchProvider,
  SearchQuery,
  SearchResults,
  CombinedSearchResults,
  MessageSearchResult,
  ChannelSearchResult,
  UserSearchResult,
  FileSearchResult,
} from './interfaces/index.js';
import type {
  SearchQueryParser,
  ParsedSearchQuery,
} from './interfaces/index.js';
import {
  SEARCH_PROVIDER,
  SEARCH_QUERY_PARSER,
  SEARCH_CACHE_PREFIX,
  SEARCH_CACHE_TTL,
  DEFAULT_SEARCH_LIMIT,
} from './constants/index.js';

export interface SearchOptions {
  limit?: number;
  offset?: number;
  type?: 'message' | 'channel' | 'user' | 'file';
}

export interface SearchResponse extends CombinedSearchResults {
  query: {
    raw: string;
    parsed: ParsedSearchQuery;
  };
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(SEARCH_PROVIDER)
    private readonly searchProvider: SearchProvider,
    @Inject(SEARCH_QUERY_PARSER)
    private readonly queryParser: SearchQueryParser,
    private readonly redisService: RedisService,
  ) {}

  async search(
    rawQuery: string,
    userId: string,
    tenantId?: string,
    options?: SearchOptions,
  ): Promise<SearchResponse> {
    // Parse the query
    const parsed = this.queryParser.parse(rawQuery);

    // Build search query
    const searchQuery = this.buildSearchQuery(parsed, tenantId, options);

    // Check cache
    const cacheKey = this.buildCacheKey(searchQuery, userId);
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as SearchResponse;
    }

    // Execute search
    const results = await this.searchProvider.searchAll(searchQuery, userId);

    const response: SearchResponse = {
      ...results,
      query: {
        raw: rawQuery,
        parsed,
      },
    };

    // Cache results
    await this.redisService.set(
      cacheKey,
      JSON.stringify(response),
      SEARCH_CACHE_TTL,
    );

    return response;
  }

  async searchMessages(
    rawQuery: string,
    userId: string,
    tenantId?: string,
    options?: SearchOptions,
  ): Promise<SearchResults<MessageSearchResult>> {
    const parsed = this.queryParser.parse(rawQuery);
    const searchQuery = this.buildSearchQuery(parsed, tenantId, options);
    return this.searchProvider.searchMessages(searchQuery, userId);
  }

  async searchChannels(
    rawQuery: string,
    userId: string,
    tenantId?: string,
    options?: SearchOptions,
  ): Promise<SearchResults<ChannelSearchResult>> {
    const parsed = this.queryParser.parse(rawQuery);
    const searchQuery = this.buildSearchQuery(parsed, tenantId, options);
    return this.searchProvider.searchChannels(searchQuery, userId);
  }

  async searchUsers(
    rawQuery: string,
    userId: string,
    tenantId?: string,
    options?: SearchOptions,
  ): Promise<SearchResults<UserSearchResult>> {
    const parsed = this.queryParser.parse(rawQuery);
    const searchQuery = this.buildSearchQuery(parsed, tenantId, options);
    return this.searchProvider.searchUsers(searchQuery, userId);
  }

  async searchFiles(
    rawQuery: string,
    userId: string,
    tenantId?: string,
    options?: SearchOptions,
  ): Promise<SearchResults<FileSearchResult>> {
    const parsed = this.queryParser.parse(rawQuery);
    const searchQuery = this.buildSearchQuery(parsed, tenantId, options);
    return this.searchProvider.searchFiles(searchQuery, userId);
  }

  private buildSearchQuery(
    parsed: ParsedSearchQuery,
    tenantId?: string,
    options?: SearchOptions,
  ): SearchQuery {
    return {
      query: parsed.text,
      tenantId,
      from: parsed.filters.from?.[0],
      in: parsed.filters.in?.[0],
      before: parsed.filters.before,
      after: parsed.filters.after,
      hasFile: parsed.filters.has?.includes('file'),
      hasImage: parsed.filters.has?.includes('image'),
      hasLink: parsed.filters.has?.includes('link'),
      isPinned: parsed.filters.is?.includes('pinned'),
      isThread: parsed.filters.is?.includes('thread'),
      isDm: parsed.filters.is?.includes('dm'),
      limit: options?.limit || DEFAULT_SEARCH_LIMIT,
      offset: options?.offset || 0,
    };
  }

  private buildCacheKey(query: SearchQuery, userId: string): string {
    const hash = createHash('md5')
      .update(JSON.stringify({ ...query, userId }))
      .digest('hex');
    return `${SEARCH_CACHE_PREFIX}${hash}`;
  }
}
