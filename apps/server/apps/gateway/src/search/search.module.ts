import { Module } from '@nestjs/common';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';
import { SearchIndexerService } from './services/index.js';
import { PostgresSearchProvider } from './providers/index.js';
import { Team9StyleQueryParser } from './parsers/index.js';
import { SEARCH_PROVIDER, SEARCH_QUERY_PARSER } from './constants/index.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    SearchIndexerService,
    Team9StyleQueryParser,
    {
      provide: SEARCH_PROVIDER,
      useClass: PostgresSearchProvider,
    },
    {
      provide: SEARCH_QUERY_PARSER,
      useClass: Team9StyleQueryParser,
    },
  ],
  exports: [SearchService, SearchIndexerService],
})
export class SearchModule {}
