import http from "../http";
import type {
  DocumentListItem,
  DocumentResponse,
  VersionResponse,
  SuggestionResponse,
  SuggestionDetailResponse,
  CreateDocumentDto,
  UpdateDocumentDto,
  SubmitSuggestionDto,
  UpdatePrivilegesDto,
  DocumentSuggestionStatus,
} from "@/types/document";

export const documentsApi = {
  list: async (): Promise<DocumentListItem[]> => {
    const response = await http.get<DocumentListItem[]>("/v1/documents");
    return response.data;
  },

  create: async (dto: CreateDocumentDto): Promise<DocumentResponse> => {
    const response = await http.post<DocumentResponse>("/v1/documents", dto);
    return response.data;
  },

  getById: async (id: string): Promise<DocumentResponse> => {
    const response = await http.get<DocumentResponse>(`/v1/documents/${id}`);
    return response.data;
  },

  update: async (
    id: string,
    dto: UpdateDocumentDto,
  ): Promise<VersionResponse> => {
    const response = await http.put<VersionResponse>(
      `/v1/documents/${id}`,
      dto,
    );
    return response.data;
  },

  updatePrivileges: async (
    id: string,
    dto: UpdatePrivilegesDto,
  ): Promise<void> => {
    await http.patch(`/v1/documents/${id}/privileges`, dto);
  },

  getVersions: async (id: string): Promise<VersionResponse[]> => {
    const response = await http.get<VersionResponse[]>(
      `/v1/documents/${id}/versions`,
    );
    return response.data;
  },

  getVersion: async (
    id: string,
    versionIndex: number,
  ): Promise<VersionResponse> => {
    const response = await http.get<VersionResponse>(
      `/v1/documents/${id}/versions/${versionIndex}`,
    );
    return response.data;
  },

  submitSuggestion: async (
    id: string,
    dto: SubmitSuggestionDto,
  ): Promise<SuggestionResponse> => {
    const response = await http.post<SuggestionResponse>(
      `/v1/documents/${id}/suggestions`,
      dto,
    );
    return response.data;
  },

  getSuggestions: async (
    id: string,
    status?: DocumentSuggestionStatus,
  ): Promise<SuggestionResponse[]> => {
    const response = await http.get<SuggestionResponse[]>(
      `/v1/documents/${id}/suggestions`,
      { params: status ? { status } : undefined },
    );
    return response.data;
  },

  getSuggestionDetail: async (
    docId: string,
    sugId: string,
  ): Promise<SuggestionDetailResponse> => {
    const response = await http.get<SuggestionDetailResponse>(
      `/v1/documents/${docId}/suggestions/${sugId}`,
    );
    return response.data;
  },

  reviewSuggestion: async (
    docId: string,
    sugId: string,
    action: "approve" | "reject",
  ): Promise<SuggestionResponse> => {
    const response = await http.post<SuggestionResponse>(
      `/v1/documents/${docId}/suggestions/${sugId}/review`,
      { action },
    );
    return response.data;
  },
};

export default documentsApi;
