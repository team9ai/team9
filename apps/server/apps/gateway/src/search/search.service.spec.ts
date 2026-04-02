import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type {
  ParsedSearchQuery,
  SearchProvider,
  SearchQueryParser,
  CombinedSearchResults,
} from './interfaces/index.js';
import {
  DEFAULT_SEARCH_LIMIT,
  SEARCH_CACHE_PREFIX,
  SEARCH_CACHE_TTL,
} from './constants/index.js';
import { SearchService } from './search.service.js';

function createCombinedResults(): CombinedSearchResults {
  return {
    messages: { items: [], total: 0, hasMore: false },
    channels: { items: [], total: 0, hasMore: false },
    users: { items: [], total: 0, hasMore: false },
    files: { items: [], total: 0, hasMore: false },
  };
}

describe('SearchService', () => {
  let searchProvider: jest.Mocked<SearchProvider>;
  let queryParser: jest.Mocked<SearchQueryParser>;
  let redisService: {
    get: jest.MockedFunction<(key: string) => Promise<string | null>>;
    set: jest.MockedFunction<
      (key: string, value: string, ttl: number) => Promise<unknown>
    >;
  };
  let service: SearchService;

  beforeEach(() => {
    searchProvider = {
      searchAll: jest.fn(),
      searchMessages: jest.fn(),
      searchChannels: jest.fn(),
      searchUsers: jest.fn(),
      searchFiles: jest.fn(),
    };

    queryParser = {
      parse: jest.fn(),
    };

    redisService = {
      get: jest.fn(),
      set: jest.fn(),
    };

    service = new SearchService(
      searchProvider,
      queryParser,
      redisService as never,
    );
  });

  it('returns cached search responses without hitting the provider', async () => {
    const parsed: ParsedSearchQuery = {
      text: 'deploys',
      filters: {},
    };
    const cachedResponse = {
      ...createCombinedResults(),
      query: {
        raw: 'deploys',
        parsed,
      },
    };
    queryParser.parse.mockReturnValue(parsed);
    redisService.get.mockResolvedValue(JSON.stringify(cachedResponse));

    await expect(service.search('deploys', 'user-1')).resolves.toEqual(
      cachedResponse,
    );

    expect(searchProvider.searchAll).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
    expect(redisService.get.mock.calls[0]?.[0]).toMatch(
      new RegExp(`^${SEARCH_CACHE_PREFIX}`),
    );
  });

  it('builds a parsed search query, hits the provider, and caches the result', async () => {
    const parsed: ParsedSearchQuery = {
      text: 'urgent bug',
      filters: {
        from: ['alice', 'bob'],
        in: ['eng'],
        before: new Date('2026-03-31T00:00:00.000Z'),
        after: new Date('2026-03-01T00:00:00.000Z'),
        has: ['file', 'link'],
        is: ['thread', 'dm'],
      },
    };
    const providerResults = createCombinedResults();
    queryParser.parse.mockReturnValue(parsed);
    redisService.get.mockResolvedValue(null);
    searchProvider.searchAll.mockResolvedValue(providerResults);

    const response = await service.search(
      'from:alice urgent bug',
      'user-1',
      't-1',
      {
        limit: 50,
        offset: 10,
      },
    );

    expect(searchProvider.searchAll).toHaveBeenCalledWith(
      {
        query: 'urgent bug',
        tenantId: 't-1',
        from: 'alice',
        in: 'eng',
        before: parsed.filters.before,
        after: parsed.filters.after,
        hasFile: true,
        hasImage: false,
        hasLink: true,
        isPinned: false,
        isThread: true,
        isDm: true,
        limit: 50,
        offset: 10,
      },
      'user-1',
    );

    const cacheKey = redisService.get.mock.calls[0]?.[0];
    expect(cacheKey).toMatch(new RegExp(`^${SEARCH_CACHE_PREFIX}`));
    expect(redisService.set).toHaveBeenCalledWith(
      cacheKey,
      JSON.stringify(response),
      SEARCH_CACHE_TTL,
    );
    expect(response).toEqual({
      ...providerResults,
      query: {
        raw: 'from:alice urgent bug',
        parsed,
      },
    });
  });

  it('uses default pagination when options are omitted', async () => {
    const parsed: ParsedSearchQuery = {
      text: 'release notes',
      filters: {},
    };
    queryParser.parse.mockReturnValue(parsed);
    searchProvider.searchMessages.mockResolvedValue({
      items: [],
      total: 0,
      hasMore: false,
    });

    await service.searchMessages('release notes', 'user-1');

    expect(searchProvider.searchMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'release notes',
        limit: DEFAULT_SEARCH_LIMIT,
        offset: 0,
      }),
      'user-1',
    );
  });

  it('routes message, channel, user, and file searches through the matching provider methods', async () => {
    const parsed: ParsedSearchQuery = {
      text: 'alpha',
      filters: {},
    };
    queryParser.parse.mockReturnValue(parsed);
    searchProvider.searchChannels.mockResolvedValue({
      items: [],
      total: 0,
      hasMore: false,
    });
    searchProvider.searchUsers.mockResolvedValue({
      items: [],
      total: 0,
      hasMore: false,
    });
    searchProvider.searchFiles.mockResolvedValue({
      items: [],
      total: 0,
      hasMore: false,
    });

    await service.searchChannels('alpha', 'user-2', 'tenant-1', { offset: 3 });
    await service.searchUsers('alpha', 'user-2');
    await service.searchFiles('alpha', 'user-2', 'tenant-1', { limit: 5 });

    expect(searchProvider.searchChannels).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'alpha',
        tenantId: 'tenant-1',
        limit: DEFAULT_SEARCH_LIMIT,
        offset: 3,
      }),
      'user-2',
    );
    expect(searchProvider.searchUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'alpha',
        limit: DEFAULT_SEARCH_LIMIT,
        offset: 0,
      }),
      'user-2',
    );
    expect(searchProvider.searchFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'alpha',
        tenantId: 'tenant-1',
        limit: 5,
        offset: 0,
      }),
      'user-2',
    );
  });
});
