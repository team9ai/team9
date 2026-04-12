import http from "../http";
import type {
  ChannelView,
  ChannelTab,
  CreateViewDto,
  UpdateViewDto,
  ViewMessageParams,
  ViewMessagesResponse,
  CreateTabDto,
  UpdateTabDto,
} from "@/types/properties";

// Views API
export const viewsApi = {
  // Get all views for a channel
  getViews: async (channelId: string): Promise<ChannelView[]> => {
    const response = await http.get<ChannelView[]>(
      `/v1/im/channels/${channelId}/views`,
    );
    return response.data;
  },

  // Create a new view
  createView: async (
    channelId: string,
    data: CreateViewDto,
  ): Promise<ChannelView> => {
    const response = await http.post<ChannelView>(
      `/v1/im/channels/${channelId}/views`,
      data,
    );
    return response.data;
  },

  // Update a view
  updateView: async (
    channelId: string,
    viewId: string,
    data: UpdateViewDto,
  ): Promise<ChannelView> => {
    const response = await http.patch<ChannelView>(
      `/v1/im/channels/${channelId}/views/${viewId}`,
      data,
    );
    return response.data;
  },

  // Delete a view
  deleteView: async (
    channelId: string,
    viewId: string,
  ): Promise<{ success: boolean }> => {
    const response = await http.delete<{ success: boolean }>(
      `/v1/im/channels/${channelId}/views/${viewId}`,
    );
    return response.data;
  },

  // Query messages through a view (with filters, sorts, grouping)
  getViewMessages: async (
    channelId: string,
    viewId: string,
    params?: ViewMessageParams,
  ): Promise<ViewMessagesResponse> => {
    const response = await http.get<ViewMessagesResponse>(
      `/v1/im/channels/${channelId}/views/${viewId}/messages`,
      { params },
    );
    return response.data;
  },
};

// Tabs API
export const tabsApi = {
  // Get all tabs for a channel
  getTabs: async (channelId: string): Promise<ChannelTab[]> => {
    const response = await http.get<ChannelTab[]>(
      `/v1/im/channels/${channelId}/tabs`,
    );
    return response.data;
  },

  // Create a new tab
  createTab: async (
    channelId: string,
    data: CreateTabDto,
  ): Promise<ChannelTab> => {
    const response = await http.post<ChannelTab>(
      `/v1/im/channels/${channelId}/tabs`,
      data,
    );
    return response.data;
  },

  // Update a tab
  updateTab: async (
    channelId: string,
    tabId: string,
    data: UpdateTabDto,
  ): Promise<ChannelTab> => {
    const response = await http.patch<ChannelTab>(
      `/v1/im/channels/${channelId}/tabs/${tabId}`,
      data,
    );
    return response.data;
  },

  // Delete a tab
  deleteTab: async (
    channelId: string,
    tabId: string,
  ): Promise<{ success: boolean }> => {
    const response = await http.delete<{ success: boolean }>(
      `/v1/im/channels/${channelId}/tabs/${tabId}`,
    );
    return response.data;
  },

  // Reorder tabs
  reorderTabs: async (
    channelId: string,
    tabIds: string[],
  ): Promise<ChannelTab[]> => {
    const response = await http.patch<ChannelTab[]>(
      `/v1/im/channels/${channelId}/tabs/order`,
      { tabIds },
    );
    return response.data;
  },
};

export default { views: viewsApi, tabs: tabsApi };
