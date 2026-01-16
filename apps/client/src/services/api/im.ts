import http from "../http";
import type {
  Channel,
  ChannelWithUnread,
  ChannelMember,
  Message,
  IMUser,
  Mention,
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
  SearchUsersParams,
  PublicChannelPreview,
  ThreadResponse,
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

  // Get message thread with nested replies
  getThread: async (
    messageId: string,
    params?: { limit?: number },
  ): Promise<ThreadResponse> => {
    const response = await http.get<ThreadResponse>(
      `/v1/im/messages/${messageId}/thread`,
      { params },
    );
    return response.data;
  },

  // Get sub-replies for a first-level reply (for expanding collapsed replies)
  getSubReplies: async (
    messageId: string,
    params?: { limit?: number },
  ): Promise<Message[]> => {
    const response = await http.get<Message[]>(
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

// Mentions API
export const mentionsApi = {
  // Get user mentions
  getMentions: async (): Promise<Mention[]> => {
    const response = await http.get<Mention[]>("/v1/im/mentions");
    return response.data;
  },
};

// Combined IM API export
export const imApi = {
  channels: channelsApi,
  messages: messagesApi,
  users: imUsersApi,
  mentions: mentionsApi,
};

export default imApi;
