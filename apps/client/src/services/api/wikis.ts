import http from "../http";
import type {
  CommitPageInput,
  CommitPageResponse,
  PageDto,
  ProposalDto,
  TreeEntryDto,
  WikiApprovalMode,
  WikiDto,
  WikiPermissionLevel,
} from "@/types/wiki";

/**
 * Creation payload — mirrors gateway `CreateWikiDto`. `slug` and `icon` are
 * optional; `approvalMode`, `humanPermission`, and `agentPermission` default
 * server-side to `auto`, `write`, and `read` respectively.
 */
export interface CreateWikiInput {
  name: string;
  slug?: string;
  icon?: string;
  approvalMode?: WikiApprovalMode;
  humanPermission?: WikiPermissionLevel;
  agentPermission?: WikiPermissionLevel;
}

/** Update payload — mirrors gateway `UpdateWikiDto`. All fields optional. */
export interface UpdateWikiInput {
  name?: string;
  slug?: string;
  approvalMode?: WikiApprovalMode;
  humanPermission?: WikiPermissionLevel;
  agentPermission?: WikiPermissionLevel;
}

/**
 * Thin wrapper over the gateway's `/v1/wikis/*` endpoints.
 *
 * Every method returns the unwrapped response body (not the `HttpResponse`
 * envelope) so hooks can just `await wikisApi.foo(...)` and return it as
 * their `queryFn` / `mutationFn` result. This matches the convention used by
 * every other `apps/client/src/services/api/*.ts` module (e.g. `documents`,
 * `routines`, `skills`).
 */
export const wikisApi = {
  list: async (): Promise<WikiDto[]> => {
    const response = await http.get<WikiDto[]>("/v1/wikis");
    return response.data;
  },

  create: async (dto: CreateWikiInput): Promise<WikiDto> => {
    const response = await http.post<WikiDto>("/v1/wikis", dto);
    return response.data;
  },

  get: async (wikiId: string): Promise<WikiDto> => {
    const response = await http.get<WikiDto>(`/v1/wikis/${wikiId}`);
    return response.data;
  },

  update: async (wikiId: string, dto: UpdateWikiInput): Promise<WikiDto> => {
    const response = await http.patch<WikiDto>(`/v1/wikis/${wikiId}`, dto);
    return response.data;
  },

  archive: async (wikiId: string): Promise<void> => {
    await http.delete(`/v1/wikis/${wikiId}`);
  },

  getTree: async (
    wikiId: string,
    opts: { path?: string; recursive?: boolean } = {},
  ): Promise<TreeEntryDto[]> => {
    const params: Record<string, string> = {};
    if (opts.path) params.path = opts.path;
    if (opts.recursive) params.recursive = "true";
    const response = await http.get<TreeEntryDto[]>(
      `/v1/wikis/${wikiId}/tree`,
      Object.keys(params).length > 0 ? { params } : undefined,
    );
    return response.data;
  },

  getPage: async (wikiId: string, path: string): Promise<PageDto> => {
    const response = await http.get<PageDto>(`/v1/wikis/${wikiId}/pages`, {
      params: { path },
    });
    return response.data;
  },

  commit: async (
    wikiId: string,
    dto: CommitPageInput,
  ): Promise<CommitPageResponse> => {
    const response = await http.post<CommitPageResponse>(
      `/v1/wikis/${wikiId}/commit`,
      dto,
    );
    return response.data;
  },

  listProposals: async (
    wikiId: string,
    status?: string,
  ): Promise<ProposalDto[]> => {
    const response = await http.get<ProposalDto[]>(
      `/v1/wikis/${wikiId}/proposals`,
      status ? { params: { status } } : undefined,
    );
    return response.data;
  },

  approveProposal: async (
    wikiId: string,
    proposalId: string,
  ): Promise<void> => {
    await http.post(`/v1/wikis/${wikiId}/proposals/${proposalId}/approve`);
  },

  rejectProposal: async (
    wikiId: string,
    proposalId: string,
    reason?: string,
  ): Promise<void> => {
    await http.post(
      `/v1/wikis/${wikiId}/proposals/${proposalId}/reject`,
      reason ? { reason } : {},
    );
  },
};

export default wikisApi;
