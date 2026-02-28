import http from "../http";
import type {
  Channel,
  ChannelWithUnread,
  ChannelMember,
  Message,
  IMUser,
  CreateChannelDto,
  UpdateChannelDto,
  DeleteChannelDto,
  CreateMessageDto,
  UpdateMessageDto,
  AddMemberDto,
  UpdateMemberDto,
  MarkAsReadDto,
  AddReactionDto,
  UpdateUserStatusDto,
  GetMessagesParams,
  PaginatedMessagesResponse,
  SearchUsersParams,
  PublicChannelPreview,
  ThreadResponse,
  SubRepliesResponse,
  GetThreadParams,
  GetSubRepliesParams,
  SyncMessagesResponse,
  SyncAckDto,
} from "@/types/im";

// Channels API
export const channelsApi = {
  // Get all user's channels with unread counts
  getChannels: async (): Promise<ChannelWithUnread[]> => {
    const response = await http.get<ChannelWithUnread[]>("/v1/im/channels");
    return response.data;
  },

  // Create a new channel
  createChannel: async (data: CreateChannelDto): Promise<Channel> => {
    const response = await http.post<Channel>("/v1/im/channels", data);
    return response.data;
  },

  // Create or get direct message channel
  createDirectChannel: async (targetUserId: string): Promise<Channel> => {
    const response = await http.post<Channel>(
      `/v1/im/channels/direct/${targetUserId}`,
    );
    return response.data;
  },

  // Get channel details
  getChannel: async (channelId: string): Promise<Channel> => {
    const response = await http.get<Channel>(`/v1/im/channels/${channelId}`);
    return response.data;
  },

  // Update channel
  updateChannel: async (
    channelId: string,
    data: UpdateChannelDto,
  ): Promise<Channel> => {
    const response = await http.patch<Channel>(
      `/v1/im/channels/${channelId}`,
      data,
    );
    return response.data;
  },

  // Get channel members
  getMembers: async (channelId: string): Promise<ChannelMember[]> => {
    const response = await http.get<ChannelMember[]>(
      `/v1/im/channels/${channelId}/members`,
    );
    return response.data;
  },

  // Add member to channel
  addMember: async (
    channelId: string,
    data: AddMemberDto,
  ): Promise<ChannelMember> => {
    const response = await http.post<ChannelMember>(
      `/v1/im/channels/${channelId}/members`,
      data,
    );
    return response.data;
  },

  // Update channel member
  updateMember: async (
    channelId: string,
    memberId: string,
    data: UpdateMemberDto,
  ): Promise<ChannelMember> => {
    const response = await http.patch<ChannelMember>(
      `/v1/im/channels/${channelId}/members/${memberId}`,
      data,
    );
    return response.data;
  },

  // Remove member from channel
  removeMember: async (channelId: string, memberId: string): Promise<void> => {
    await http.delete(`/v1/im/channels/${channelId}/members/${memberId}`);
  },

  // Leave channel
  leaveChannel: async (channelId: string): Promise<void> => {
    await http.post(`/v1/im/channels/${channelId}/leave`);
  },

  // Mark messages as read
  markAsRead: async (channelId: string, data: MarkAsReadDto): Promise<void> => {
    await http.post(`/v1/im/channels/${channelId}/read`, data);
  },

  // Delete or archive channel
  deleteChannel: async (
    channelId: string,
    data?: DeleteChannelDto,
  ): Promise<void> => {
    await http.delete(`/v1/im/channels/${channelId}`, { data });
  },

  // Unarchive channel
  unarchiveChannel: async (channelId: string): Promise<Channel> => {
    const response = await http.post<Channel>(
      `/v1/im/channels/${channelId}/unarchive`,
    );
    return response.data;
  },

  // Get all public channels in workspace
  getPublicChannels: async (): Promise<PublicChannelPreview[]> => {
    const response = await http.get<PublicChannelPreview[]>(
      "/v1/im/channels/public",
    );
    return response.data;
  },

  // Get public channel preview (for non-members)
  getChannelPreview: async (
    channelId: string,
  ): Promise<PublicChannelPreview> => {
    const response = await http.get<PublicChannelPreview>(
      `/v1/im/channels/${channelId}/preview`,
    );
    return response.data;
  },

  // Join a public channel
  joinChannel: async (channelId: string): Promise<void> => {
    await http.post(`/v1/im/channels/${channelId}/join`);
  },
};

// Messages API
export const messagesApi = {
  // Get channel messages
  getMessages: async (
    channelId: string,
    params?: GetMessagesParams,
  ): Promise<Message[]> => {
    const response = await http.get<Message[]>(
      `/v1/im/channels/${channelId}/messages`,
      { params },
    );
    return response.data;
  },

  // Get channel messages with pagination metadata (supports after/around cursors)
  // Server returns flat Message[] when no after/around param; normalize to PaginatedMessagesResponse
  getMessagesPaginated: async (
    channelId: string,
    params?: GetMessagesParams,
  ): Promise<PaginatedMessagesResponse> => {
    const response = await http.get(`/v1/im/channels/${channelId}/messages`, {
      params,
    });
    const data = response.data;
    // Server returns flat array for backward compatibility when no after/around cursor
    if (Array.isArray(data)) {
      return {
        messages: data as Message[],
        hasOlder: data.length >= (params?.limit ?? 50),
        hasNewer: false,
      };
    }
    return data as PaginatedMessagesResponse;
  },

  // Send message to channel
  sendMessage: async (
    channelId: string,
    data: CreateMessageDto,
  ): Promise<Message> => {
    const response = await http.post<Message>(
      `/v1/im/channels/${channelId}/messages`,
      data,
    );
    return response.data;
  },

  // Get specific message
  getMessage: async (messageId: string): Promise<Message> => {
    const response = await http.get<Message>(`/v1/im/messages/${messageId}`);
    return response.data;
  },

  // Update message
  updateMessage: async (
    messageId: string,
    data: UpdateMessageDto,
  ): Promise<Message> => {
    const response = await http.patch<Message>(
      `/v1/im/messages/${messageId}`,
      data,
    );
    return response.data;
  },

  // Delete message
  deleteMessage: async (messageId: string): Promise<void> => {
    await http.delete(`/v1/im/messages/${messageId}`);
  },

  // Get message thread with nested replies (supports cursor-based pagination)
  getThread: async (
    messageId: string,
    params?: GetThreadParams,
  ): Promise<ThreadResponse> => {
    const response = await http.get<ThreadResponse>(
      `/v1/im/messages/${messageId}/thread`,
      { params },
    );
    return response.data;
  },

  // Get sub-replies for a first-level reply (supports cursor-based pagination)
  getSubReplies: async (
    messageId: string,
    params?: GetSubRepliesParams,
  ): Promise<SubRepliesResponse> => {
    const response = await http.get<SubRepliesResponse>(
      `/v1/im/messages/${messageId}/sub-replies`,
      { params },
    );
    return response.data;
  },

  // Get pinned messages
  getPinnedMessages: async (channelId: string): Promise<Message[]> => {
    const response = await http.get<Message[]>(
      `/v1/im/channels/${channelId}/pinned`,
    );
    return response.data;
  },

  // Pin message
  pinMessage: async (messageId: string): Promise<void> => {
    await http.post(`/v1/im/messages/${messageId}/pin`);
  },

  // Unpin message
  unpinMessage: async (messageId: string): Promise<void> => {
    await http.delete(`/v1/im/messages/${messageId}/pin`);
  },

  // Add reaction
  addReaction: async (
    messageId: string,
    data: AddReactionDto,
  ): Promise<void> => {
    await http.post(`/v1/im/messages/${messageId}/reactions`, data);
  },

  // Remove reaction
  removeReaction: async (messageId: string, emoji: string): Promise<void> => {
    await http.delete(`/v1/im/messages/${messageId}/reactions/${emoji}`);
  },
};

// Users API
export const imUsersApi = {
  // Search users
  searchUsers: async (params: SearchUsersParams): Promise<IMUser[]> => {
    const response = await http.get<IMUser[]>("/v1/im/users", { params });
    return response.data;
  },

  // Get online users
  getOnlineUsers: async (): Promise<Record<string, string>> => {
    const response = await http.get<Record<string, string>>(
      "/v1/im/users/online",
    );
    return response.data;
  },

  // Get user profile
  getUser: async (userId: string): Promise<IMUser> => {
    const response = await http.get<IMUser>(`/v1/im/users/${userId}`);
    return response.data;
  },

  // Update current user profile
  updateMe: async (data: {
    username?: string;
    displayName?: string;
    avatarUrl?: string;
  }): Promise<IMUser> => {
    const response = await http.patch<IMUser>("/v1/im/users/me", data);
    return response.data;
  },

  // Update user status
  updateStatus: async (data: UpdateUserStatusDto): Promise<void> => {
    await http.patch("/v1/im/users/me/status", data);
  },
};

// Sections API
export interface Section {
  id: string;
  tenantId: string | null;
  name: string;
  order: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSectionDto {
  name: string;
}

export interface UpdateSectionDto {
  name?: string;
}

export interface MoveChannelDto {
  sectionId?: string | null;
  order?: number;
}

export const sectionsApi = {
  // Get all sections
  getSections: async (): Promise<Section[]> => {
    const response = await http.get<Section[]>("/v1/im/sections");
    return response.data;
  },

  // Create a new section
  createSection: async (data: CreateSectionDto): Promise<Section> => {
    const response = await http.post<Section>("/v1/im/sections", data);
    return response.data;
  },

  // Update section
  updateSection: async (
    sectionId: string,
    data: UpdateSectionDto,
  ): Promise<Section> => {
    const response = await http.patch<Section>(
      `/v1/im/sections/${sectionId}`,
      data,
    );
    return response.data;
  },

  // Delete section
  deleteSection: async (sectionId: string): Promise<void> => {
    await http.delete(`/v1/im/sections/${sectionId}`);
  },

  // Reorder sections
  reorderSections: async (sectionIds: string[]): Promise<Section[]> => {
    const response = await http.patch<Section[]>("/v1/im/sections/reorder", {
      sectionIds,
    });
    return response.data;
  },

  // Move channel to section
  moveChannel: async (
    channelId: string,
    data: MoveChannelDto,
  ): Promise<void> => {
    await http.patch(`/v1/im/channels/${channelId}/move`, data);
  },
};

// Sync API
export const syncApi = {
  // Sync messages for a channel (lazy loading - called when opening a channel)
  syncChannel: async (
    channelId: string,
    limit?: number,
  ): Promise<SyncMessagesResponse> => {
    const response = await http.get<SyncMessagesResponse>(
      `/v1/im/sync/channel/${channelId}`,
      { params: limit ? { limit } : undefined },
    );
    return response.data;
  },

  // Acknowledge sync position (update lastSyncSeqId)
  ackSync: async (data: SyncAckDto): Promise<void> => {
    await http.post("/v1/im/sync/ack", data);
  },
};

// Combined IM API export
export const imApi = {
  channels: channelsApi,
  messages: messagesApi,
  users: imUsersApi,
  sync: syncApi,
  sections: sectionsApi,
};

export default imApi;
