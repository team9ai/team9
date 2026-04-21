import http from "../http";
import { API_BASE_URL } from "@/constants/api-base-url";
import { getAuthToken } from "../auth-session";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type {
  CommitPageInput,
  CommitPageResponse,
  PageDto,
  ProposalDiffEntry,
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
  icon?: string;
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
    await http.post(`/v1/wikis/${wikiId}/proposals/${proposalId}/approve`, {});
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

  /**
   * Fetch the diff summary for a proposal. Returns folder9's native
   * PascalCase diff entries unchanged — see `ProposalDiffEntry` in
   * `@/types/wiki` for the shape.
   */
  getProposalDiff: async (
    wikiId: string,
    proposalId: string,
  ): Promise<ProposalDiffEntry[]> => {
    const response = await http.get<ProposalDiffEntry[]>(
      `/v1/wikis/${wikiId}/proposals/${proposalId}/diff`,
    );
    return response.data;
  },

  /**
   * Fetch a raw (binary) file from a Wiki and return a same-origin `blob:`
   * URL suitable for `<img src>` or `background-image: url(...)`.
   *
   * The gateway's `/raw` endpoint is JWT-protected, so we can't just hand
   * the bare URL to the browser for image loading — the browser wouldn't
   * attach our bearer token. We fetch with the same auth interceptor
   * headers as the rest of the app, then wrap the bytes in an object URL.
   *
   * Callers are responsible for releasing the URL via `URL.revokeObjectURL`
   * once the image is no longer needed (e.g. on unmount / path change).
   */
  getRawObjectUrl: async (wikiId: string, path: string): Promise<string> => {
    const workspaceId = useWorkspaceStore.getState().selectedWorkspaceId;
    const token = getAuthToken();
    const url = `${API_BASE_URL}/v1/wikis/${wikiId}/raw?path=${encodeURIComponent(
      path,
    )}`;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (workspaceId) headers["X-Tenant-Id"] = workspaceId;

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch wiki raw asset: ${response.status}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  },
};

export default wikisApi;
