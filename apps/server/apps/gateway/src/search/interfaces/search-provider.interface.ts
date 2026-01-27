import type { SearchQuery } from './search-query.interface.js';

// ==========================================
// Search Result Types
// ==========================================

export interface SearchResultItem<T = unknown> {
  id: string;
  type: 'message' | 'channel' | 'user' | 'file';
  score: number;
  highlight?: string;
  data: T;
}

export interface MessageSearchResult {
  id: string;
  channelId: string;
  channelName: string | null;
  senderId: string | null;
  senderUsername: string | null;
  senderDisplayName: string | null;
  content: string | null;
  messageType: string | null;
  hasAttachment: boolean;
  isPinned: boolean;
  isThreadReply: boolean;
  createdAt: Date;
}

export interface ChannelSearchResult {
  id: string;
  name: string | null;
  description: string | null;
  channelType: string | null;
  memberCount: number;
  isArchived: boolean;
  tenantId: string | null;
  createdAt: Date;
}

export interface UserSearchResult {
  id: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  status: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface FileSearchResult {
  id: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  channelId: string | null;
  channelName: string | null;
  uploaderId: string | null;
  uploaderUsername: string | null;
  createdAt: Date;
}

export interface SearchResults<T = unknown> {
  items: SearchResultItem<T>[];
  total: number;
  hasMore: boolean;
}

export interface CombinedSearchResults {
  messages: SearchResults<MessageSearchResult>;
  channels: SearchResults<ChannelSearchResult>;
  users: SearchResults<UserSearchResult>;
  files: SearchResults<FileSearchResult>;
}

// ==========================================
// Search Provider Interface
// ==========================================

export interface SearchProvider {
  searchMessages(
    query: SearchQuery,
    userId: string,
  ): Promise<SearchResults<MessageSearchResult>>;

  searchChannels(
    query: SearchQuery,
    userId: string,
  ): Promise<SearchResults<ChannelSearchResult>>;

  searchUsers(
    query: SearchQuery,
    userId: string,
  ): Promise<SearchResults<UserSearchResult>>;

  searchFiles(
    query: SearchQuery,
    userId: string,
  ): Promise<SearchResults<FileSearchResult>>;

  searchAll(query: SearchQuery, userId: string): Promise<CombinedSearchResults>;
}
