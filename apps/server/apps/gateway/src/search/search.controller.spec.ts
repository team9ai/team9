import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule(
  '../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenantId: () => () => undefined,
  }),
);

jest.unstable_mockModule('./search.service.js', () => ({
  SearchService: class SearchService {},
}));

jest.unstable_mockModule('./services/index.js', () => ({
  SearchIndexerService: class SearchIndexerService {},
}));

const { SearchController } = await import('./search.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('SearchController', () => {
  let controller: any;
  let searchService: {
    search: MockFn;
    searchMessages: MockFn;
    searchChannels: MockFn;
    searchUsers: MockFn;
    searchFiles: MockFn;
  };
  let searchIndexerService: {
    reindexAll: MockFn;
  };

  beforeEach(() => {
    searchService = {
      search: jest.fn<any>(),
      searchMessages: jest.fn<any>(),
      searchChannels: jest.fn<any>(),
      searchUsers: jest.fn<any>(),
      searchFiles: jest.fn<any>(),
    };

    searchIndexerService = {
      reindexAll: jest.fn<any>().mockResolvedValue(undefined),
    };

    controller = new SearchController(
      searchService as any,
      searchIndexerService as any,
    );
  });

  it('forwards query params, user, tenant, and search options to search()', async () => {
    const response = {
      results: [{ id: 'message-1' }],
      query: {
        raw: 'hello',
        parsed: { text: 'hello', filters: {} },
      },
    } as any;
    searchService.search.mockResolvedValue(response);

    const result = await controller.search('user-1', 'tenant-1', {
      q: 'hello',
      limit: 25,
      offset: 5,
      type: 'message',
    } as any);

    expect(searchService.search).toHaveBeenCalledWith(
      'hello',
      'user-1',
      'tenant-1',
      {
        limit: 25,
        offset: 5,
        type: 'message',
      },
    );
    expect(result).toEqual(response);
  });

  it.each([
    {
      method: 'searchMessages',
      serviceKey: 'searchMessages',
      result: { items: [{ id: 'message-1' }] },
    },
    {
      method: 'searchChannels',
      serviceKey: 'searchChannels',
      result: { items: [{ id: 'channel-1' }] },
    },
    {
      method: 'searchUsers',
      serviceKey: 'searchUsers',
      result: { items: [{ id: 'user-1' }] },
    },
    {
      method: 'searchFiles',
      serviceKey: 'searchFiles',
      result: { items: [{ id: 'file-1' }] },
    },
  ])(
    'forwards query params to $method() and returns the service result',
    async ({ serviceKey, result }) => {
      searchService[serviceKey].mockResolvedValue(result);

      const controllerMethod = controller[serviceKey].bind(controller);
      const response = await controllerMethod('user-2', 'tenant-2', {
        q: 'kotlin',
        limit: 10,
        offset: 2,
      } as any);

      expect(searchService[serviceKey]).toHaveBeenCalledWith(
        'kotlin',
        'user-2',
        'tenant-2',
        {
          limit: 10,
          offset: 2,
        },
      );
      expect(response).toEqual(result);
    },
  );

  it('starts reindexing in the background and returns immediately', async () => {
    const deferred = new Promise<void>(() => undefined);
    searchIndexerService.reindexAll.mockReturnValue(deferred);

    const result = await controller.reindexAll();

    expect(searchIndexerService.reindexAll).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      message: 'Reindex started in background. Check logs for progress.',
    });
  });
});
