export interface SearchQuery {
  // Main search query text
  query: string;

  // Slack-style filters
  from?: string; // from:@username
  in?: string; // in:#channel
  before?: Date; // before:2024-01-01
  after?: Date; // after:2024-01-01
  hasFile?: boolean; // has:file
  hasImage?: boolean; // has:image
  hasLink?: boolean; // has:link
  isPinned?: boolean; // is:pinned
  isThread?: boolean; // is:thread
  isDm?: boolean; // is:dm

  // Tenant isolation
  tenantId?: string;

  // Pagination
  limit?: number;
  offset?: number;
}

export interface ParsedSearchQuery {
  text: string; // Main search text after removing filters
  filters: SearchFilters;
}

export interface SearchFilters {
  from?: string[]; // from:@user1 from:@user2
  in?: string[]; // in:#channel1 in:#channel2
  before?: Date;
  after?: Date;
  during?: 'today' | 'week' | 'month' | 'year';
  has?: ('file' | 'image' | 'link' | 'reaction')[];
  is?: ('pinned' | 'thread' | 'dm')[];
  type?: ('message' | 'channel' | 'user' | 'file')[];
}

export interface SearchQueryParser {
  parse(query: string): ParsedSearchQuery;
}
