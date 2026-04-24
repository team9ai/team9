import http from "../http";

// Search result types
export interface MessageSearchResultData {
  id: string;
  channelId: string;
  channelName: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  content: string;
  messageType: string;
  hasAttachment: boolean;
  isPinned: boolean;
  isThreadReply: boolean;
  createdAt: string;
}

export interface ChannelSearchResultData {
  id: string;
  name: string;
  description: string;
  channelType: string;
  memberCount: number;
  isArchived: boolean;
  tenantId: string | null;
  createdAt: string;
}

export interface UserSearchResultData {
  id: string;
  username: string;
  displayName: string;
  email: string;
  status: string;
  isActive: boolean;
  createdAt: string;
}

export interface FileSearchResultData {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  channelId: string;
  channelName: string;
  uploaderId: string;
  uploaderUsername: string;
  createdAt: string;
}

export interface SearchResultItem<T = unknown> {
  id: string;
  type: "message" | "channel" | "user" | "file";
  score: number;
  highlight: string;
  data: T;
}

export interface SearchResults<T> {
  items: SearchResultItem<T>[];
  total: number;
  hasMore: boolean;
}

export interface CombinedSearchResponse {
  messages: SearchResults<MessageSearchResultData>;
  channels: SearchResults<ChannelSearchResultData>;
  users: SearchResults<UserSearchResultData>;
  files: SearchResults<FileSearchResultData>;
  query: {
    raw: string;
    parsed: {
      text: string;
      filters: Record<string, string>;
    };
  };
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  type?: "message" | "channel" | "user" | "file";
}

export const searchApi = {
  // Unified search across all types
  search: async (
    q: string,
    options?: SearchOptions,
  ): Promise<CombinedSearchResponse> => {
    const response = await http.get<CombinedSearchResponse>("/v1/search", {
      params: { q, ...options },
    });
    return response.data;
  },

  // Search messages only
  searchMessages: async (
    q: string,
    options?: Omit<SearchOptions, "type">,
  ): Promise<SearchResults<MessageSearchResultData>> => {
    const response = await http.get<SearchResults<MessageSearchResultData>>(
      "/v1/search/messages",
      { params: { q, ...options } },
    );
    return response.data;
  },

  // Search channels only
  searchChannels: async (
    q: string,
    options?: Omit<SearchOptions, "type">,
  ): Promise<SearchResults<ChannelSearchResultData>> => {
    const response = await http.get<SearchResults<ChannelSearchResultData>>(
      "/v1/search/channels",
      { params: { q, ...options } },
    );
    return response.data;
  },

  // Search users only
  searchUsers: async (
    q: string,
    options?: Omit<SearchOptions, "type">,
  ): Promise<SearchResults<UserSearchResultData>> => {
    const response = await http.get<SearchResults<UserSearchResultData>>(
      "/v1/search/users",
      { params: { q, ...options } },
    );
    return response.data;
  },

  // Search files only
  searchFiles: async (
    q: string,
    options?: Omit<SearchOptions, "type">,
  ): Promise<SearchResults<FileSearchResultData>> => {
    const response = await http.get<SearchResults<FileSearchResultData>>(
      "/v1/search/files",
      { params: { q, ...options } },
    );
    return response.data;
  },

  // Trigger reindex (admin only)
  reindex: async (): Promise<{ success: boolean; message: string }> => {
    const response = await http.post<{ success: boolean; message: string }>(
      "/v1/search/reindex",
    );
    return response.data;
  },
};

export default searchApi;
