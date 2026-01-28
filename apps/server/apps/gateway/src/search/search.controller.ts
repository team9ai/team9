import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import {
  SearchService,
  SearchResponse,
  SearchOptions,
} from './search.service.js';
import { SearchIndexerService } from './services/index.js';
import { SearchQueryDto } from './dto/index.js';
import type {
  SearchResults,
  MessageSearchResult,
  ChannelSearchResult,
  UserSearchResult,
  FileSearchResult,
} from './interfaces/index.js';

@Controller({
  path: 'search',
  version: '1',
})
@UseGuards(AuthGuard)
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly searchIndexerService: SearchIndexerService,
  ) {}

  @Get()
  async search(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Query() dto: SearchQueryDto,
  ): Promise<SearchResponse> {
    const options: SearchOptions = {
      limit: dto.limit,
      offset: dto.offset,
      type: dto.type,
    };

    return this.searchService.search(dto.q, userId, tenantId, options);
  }

  @Get('messages')
  async searchMessages(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Query() dto: SearchQueryDto,
  ): Promise<SearchResults<MessageSearchResult>> {
    const options: SearchOptions = {
      limit: dto.limit,
      offset: dto.offset,
    };

    return this.searchService.searchMessages(dto.q, userId, tenantId, options);
  }

  @Get('channels')
  async searchChannels(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Query() dto: SearchQueryDto,
  ): Promise<SearchResults<ChannelSearchResult>> {
    const options: SearchOptions = {
      limit: dto.limit,
      offset: dto.offset,
    };

    return this.searchService.searchChannels(dto.q, userId, tenantId, options);
  }

  @Get('users')
  async searchUsers(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Query() dto: SearchQueryDto,
  ): Promise<SearchResults<UserSearchResult>> {
    const options: SearchOptions = {
      limit: dto.limit,
      offset: dto.offset,
    };

    return this.searchService.searchUsers(dto.q, userId, tenantId, options);
  }

  @Get('files')
  async searchFiles(
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string | undefined,
    @Query() dto: SearchQueryDto,
  ): Promise<SearchResults<FileSearchResult>> {
    const options: SearchOptions = {
      limit: dto.limit,
      offset: dto.offset,
    };

    return this.searchService.searchFiles(dto.q, userId, tenantId, options);
  }

  /**
   * Rebuild search index for all entities
   * Call this after migration to index existing data
   */
  @Post('reindex')
  async reindexAll(): Promise<{ success: boolean; message: string }> {
    // Run in background to avoid timeout
    this.searchIndexerService.reindexAll().catch((err) => {
      console.error('Reindex failed:', err);
    });

    return {
      success: true,
      message: 'Reindex started in background. Check logs for progress.',
    };
  }
}
