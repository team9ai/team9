import http from "../http";
import type {
  PropertyDefinition,
  CreatePropertyDefinitionDto,
  UpdatePropertyDefinitionDto,
  BatchSetPropertyEntry,
  AuditLogParams,
  AuditLogsResponse,
} from "@/types/properties";

// Property Definitions API
export const propertyDefinitionsApi = {
  // Get all property definitions for a channel
  getDefinitions: async (channelId: string): Promise<PropertyDefinition[]> => {
    const response = await http.get<PropertyDefinition[]>(
      `/v1/im/channels/${channelId}/property-definitions`,
    );
    return response.data;
  },

  // Create a new property definition
  createDefinition: async (
    channelId: string,
    data: CreatePropertyDefinitionDto,
  ): Promise<PropertyDefinition> => {
    const response = await http.post<PropertyDefinition>(
      `/v1/im/channels/${channelId}/property-definitions`,
      data,
    );
    return response.data;
  },

  // Update a property definition
  updateDefinition: async (
    channelId: string,
    definitionId: string,
    data: UpdatePropertyDefinitionDto,
  ): Promise<PropertyDefinition> => {
    const response = await http.patch<PropertyDefinition>(
      `/v1/im/channels/${channelId}/property-definitions/${definitionId}`,
      data,
    );
    return response.data;
  },

  // Delete a property definition
  deleteDefinition: async (
    channelId: string,
    definitionId: string,
  ): Promise<{ success: boolean }> => {
    const response = await http.delete<{ success: boolean }>(
      `/v1/im/channels/${channelId}/property-definitions/${definitionId}`,
    );
    return response.data;
  },

  // Reorder property definitions
  reorderDefinitions: async (
    channelId: string,
    definitionIds: string[],
  ): Promise<PropertyDefinition[]> => {
    const response = await http.patch<PropertyDefinition[]>(
      `/v1/im/channels/${channelId}/property-definitions/order`,
      { definitionIds },
    );
    return response.data;
  },
};

// AI Auto-Fill API
export const aiAutoFillApi = {
  // Trigger AI auto-fill for message properties. Runs synchronously — the
  // response contains the fields the AI actually filled and any skipped keys.
  autoFill: async (
    messageId: string,
    options?: { fields?: string[]; preserveExisting?: boolean },
  ): Promise<{ filled: Record<string, unknown>; skipped: string[] }> => {
    const response = await http.post<{
      filled: Record<string, unknown>;
      skipped: string[];
    }>(`/v1/im/messages/${messageId}/properties/auto-fill`, options ?? {});
    return response.data;
  },
};

// Message Properties API
export const messagePropertiesApi = {
  // Get all properties for a message
  getMessageProperties: async (
    messageId: string,
  ): Promise<Record<string, unknown>> => {
    const response = await http.get<Record<string, unknown>>(
      `/v1/im/messages/${messageId}/properties`,
    );
    return response.data;
  },

  // Set a single property value
  setProperty: async (
    messageId: string,
    definitionId: string,
    value: unknown,
  ): Promise<{ success: boolean }> => {
    const response = await http.put<{ success: boolean }>(
      `/v1/im/messages/${messageId}/properties/${definitionId}`,
      { value },
    );
    return response.data;
  },

  // Remove a property value
  removeProperty: async (
    messageId: string,
    definitionId: string,
  ): Promise<{ success: boolean }> => {
    const response = await http.delete<{ success: boolean }>(
      `/v1/im/messages/${messageId}/properties/${definitionId}`,
    );
    return response.data;
  },

  // Batch set multiple properties by key
  batchSetProperties: async (
    messageId: string,
    properties: BatchSetPropertyEntry[],
  ): Promise<{ success: boolean }> => {
    const response = await http.patch<{ success: boolean }>(
      `/v1/im/messages/${messageId}/properties`,
      { properties },
    );
    return response.data;
  },
};

// Audit Logs API
export const auditLogsApi = {
  // Get audit logs for a channel
  getAuditLogs: async (
    channelId: string,
    params?: AuditLogParams,
  ): Promise<AuditLogsResponse> => {
    const response = await http.get<AuditLogsResponse>(
      `/v1/im/channels/${channelId}/audit-logs`,
      { params },
    );
    return response.data;
  },
};

// Combined properties API export
export const propertiesApi = {
  definitions: propertyDefinitionsApi,
  messageProperties: messagePropertiesApi,
  aiAutoFill: aiAutoFillApi,
  auditLogs: auditLogsApi,
};

export default propertiesApi;
