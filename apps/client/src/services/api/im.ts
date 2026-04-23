import http from "../http";
import { isTauriApp } from "@/lib/tauri";
import { useAhandStore } from "@/stores/useAhandStore";
import { useAppStore } from "@/stores/useAppStore";
import type { ClientContext } from "@/types/im";
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
import { normalizeMessage, normalizeMessages } from "./normalize-reactions";

function buildClientContext(): ClientContext {
  if (!isTauriApp()) return { kind: "web" };
  const userId = useAppStore.getState().user?.id;
  if (!userId) return { kind: "macapp", deviceId: null };
  const deviceId = useAhandStore.getState().getDeviceIdForUser(userId);
  return { kind: "macapp", deviceId: deviceId ?? null };
}

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

  // Set sidebar visibility for DM/echo channels
  setSidebarVisibility: async (
    channelId: string,
    show: boolean,
  ): Promise<void> => {
    await http.patch(`/v1/im/channels/${channelId}/sidebar-visibility`, {
      show,
    });
  },

  // Get the effective LLM model for this channel's agent session.
  // Only available on human↔agent DM and routine-session channels.
  getChannelModel: async (
    channelId: string,
  ): Promise<{
    channelId: string;
    model: { provider: string; id: string };
    source: "agent_default" | "session_initial" | "dynamic";
    override: { provider: string; id: string } | null;
  }> => {
    const response = await http.get<{
      channelId: string;
      model: { provider: string; id: string };
      source: "agent_default" | "session_initial" | "dynamic";
      override: { provider: string; id: string } | null;
    }>(`/v1/im/channels/${channelId}/model`);
    return response.data;
  },

  // Switch this channel's session-level model.
  updateChannelModel: async (
    channelId: string,
    model: { provider: string; id: string },
  ): Promise<{
    channelId: string;
    model: { provider: string; id: string };
    source: "agent_default" | "session_initial" | "dynamic";
    override: { provider: string; id: string } | null;
  }> => {
    const response = await http.patch<{
      channelId: string;
      model: { provider: string; id: string };
      source: "agent_default" | "session_initial" | "dynamic";
      override: { provider: string; id: string } | null;
    }>(`/v1/im/channels/${channelId}/model`, { model });
    return response.data;
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
    return normalizeMessages(response.data);
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
        messages: normalizeMessages(data as Message[]),
        hasOlder: data.length >= (params?.limit ?? 50),
        hasNewer: false,
      };
    }
    const paginated = data as PaginatedMessagesResponse;
    return { ...paginated, messages: normalizeMessages(paginated.messages) };
  },

  // Send message to channel
  sendMessage: async (
    channelId: string,
    data: CreateMessageDto,
  ): Promise<Message> => {
    const response = await http.post<Message>(
      `/v1/im/channels/${channelId}/messages`,
      { ...data, clientContext: buildClientContext() },
    );
    return normalizeMessage(response.data);
  },

  // Get specific message
  getMessage: async (messageId: string): Promise<Message> => {
    const response = await http.get<Message>(`/v1/im/messages/${messageId}`);
    return normalizeMessage(response.data);
  },

  // Get full content of a long_text message
  getFullContent: async (messageId: string): Promise<{ content: string }> => {
    const response = await http.get<{ content: string }>(
      `/v1/im/messages/${messageId}/full-content`,
    );
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
    return normalizeMessage(response.data);
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
    const data = response.data;
    return {
      ...data,
      rootMessage: normalizeMessage(data.rootMessage),
      replies: data.replies.map((r) => ({
        ...normalizeMessage(r),
        subReplies: normalizeMessages(r.subReplies),
        subReplyCount: r.subReplyCount,
      })),
    };
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
    return {
      ...response.data,
      replies: normalizeMessages(response.data.replies),
    };
  },

  // Get pinned messages
  getPinnedMessages: async (channelId: string): Promise<Message[]> => {
    const response = await http.get<Message[]>(
      `/v1/im/channels/${channelId}/pinned`,
    );
    return normalizeMessages(response.data);
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
    language?: string;
    timeZone?: string;
  }): Promise<IMUser> => {
    const response = await http.patch<IMUser>("/v1/im/users/me", data);
    return response.data;
  },

  // Update user status
  updateStatus: async (data: UpdateUserStatusDto): Promise<void> => {
    await http.patch("/v1/im/users/me/status", data);
  },
};

// Account API
export const accountApi = {
  // Get current pending email change request
  getPendingEmailChange: async (): Promise<{
    pendingEmailChange: {
      id: string;
      currentEmail: string;
      newEmail: string;
      expiresAt?: string;
      createdAt?: string;
    } | null;
  }> => {
    const response = await http.get("/v1/account/email-change");
    return response.data;
  },

  // Start a new email change request
  startEmailChange: async (data: {
    newEmail: string;
  }): Promise<{
    message: string;
    pendingEmailChange: {
      id: string;
      currentEmail: string;
      newEmail: string;
      expiresAt?: string;
      createdAt?: string;
    } | null;
  }> => {
    const response = await http.post("/v1/account/email-change", data);
    return response.data;
  },

  // Resend the current email change confirmation
  resendEmailChange: async (): Promise<{
    message: string;
    pendingEmailChange: {
      id: string;
      currentEmail: string;
      newEmail: string;
      expiresAt?: string;
      createdAt?: string;
    } | null;
  }> => {
    const response = await http.post("/v1/account/email-change/resend");
    return response.data;
  },

  // Cancel the current email change request
  cancelEmailChange: async (): Promise<{ message: string }> => {
    const response = await http.delete("/v1/account/email-change");
    return response.data;
  },

  // Confirm an email change token after explicit user action
  confirmEmailChange: async (token: string): Promise<{ message: string }> => {
    const response = await http.post("/v1/account/confirm-email-change", {
      token,
    });
    return response.data;
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

// Topic Sessions API
export interface CreateTopicSessionDto {
  /** Bot shadow user id (target agent). */
  botUserId: string;
  /** First user message. Server persists it atomically with the channel. */
  initialMessage: string;
  /** Optional session-initial model override. */
  model?: { provider: string; id: string };
  /** Optional pre-set title (usually left null and auto-generated later). */
  title?: string;
}

export interface TopicSessionResponse {
  channelId: string;
  sessionId: string;
  agentId: string;
  botUserId: string;
  title: string | null;
  createdAt: string;
}

export interface TopicSessionRecentEntry {
  channelId: string;
  sessionId: string;
  title: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
}

export interface TopicSessionGroup {
  agentUserId: string;
  agentId: string;
  agentDisplayName: string;
  agentAvatarUrl: string | null;
  legacyDirectChannelId: string | null;
  totalCount: number;
  recentSessions: TopicSessionRecentEntry[];
}

export const topicSessionsApi = {
  /**
   * Create a new topic session: atomically provisions an agent-pi session,
   * a team9 channel, and the first user message. Returns the new channelId
   * so the caller can navigate to it — no follow-up message send needed.
   */
  create: async (
    data: CreateTopicSessionDto,
  ): Promise<TopicSessionResponse> => {
    const response = await http.post<TopicSessionResponse>(
      "/v1/im/topic-sessions",
      data,
    );
    return response.data;
  },

  /**
   * Sidebar data source: groups the caller's topic sessions by agent,
   * returning N most-recent per agent plus any legacy direct channel
   * with the same agent. One round trip, no N+1.
   */
  getGrouped: async (perAgent = 5): Promise<TopicSessionGroup[]> => {
    const response = await http.get<TopicSessionGroup[]>(
      "/v1/im/topic-sessions/grouped",
      { params: { perAgent } },
    );
    return response.data;
  },

  /** Archive a topic session (creator-only on server). */
  delete: async (channelId: string): Promise<void> => {
    await http.delete(`/v1/im/topic-sessions/${channelId}`);
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
  topicSessions: topicSessionsApi,
};

export default imApi;
