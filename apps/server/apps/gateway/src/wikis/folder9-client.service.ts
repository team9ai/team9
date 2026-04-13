import { Injectable } from '@nestjs/common';
import { env } from '@team9/shared';

import {
  Folder9ApiError,
  Folder9BlobResponse,
  Folder9CommitRequest,
  Folder9CommitResponse,
  Folder9CreateFolderInput,
  Folder9DiffEntry,
  Folder9Folder,
  Folder9NetworkError,
  Folder9Proposal,
  Folder9ProposalWithDiff,
  Folder9TreeEntry,
  Folder9UpdateFolderInput,
} from './types/folder9.types.js';

/**
 * folder9 authenticates every request through a single header:
 *   Authorization: Bearer <value>
 *
 * - For folder CRUD (/api/workspaces/{wsId}/folders[/:id]) the <value> is the
 *   pre-shared key (FOLDER9_PSK).
 * - For file/proposal operations nested under a specific folder, the <value>
 *   is an opaque folder-scoped token previously minted via POST /api/tokens.
 *
 * Confirmed by reading folder9/internal/api/middleware_psk.go and
 * middleware_token.go.
 */
const AUTH_HEADER = 'Authorization';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * Authentication variant for a single request:
 * - 'psk'   → Use FOLDER9_PSK as the Bearer value (folder management endpoints).
 * - a string → Use the given opaque token as the Bearer value (token-protected endpoints).
 */
type AuthMode = 'psk' | { token: string };

/**
 * Thin typed `fetch` wrapper around folder9's REST API.
 *
 * Every method:
 *   - Attaches the correct Authorization header (PSK or token)
 *   - Parses JSON bodies (or returns undefined for empty responses)
 *   - Throws {@link Folder9ApiError} on non-2xx responses
 *   - Throws {@link Folder9NetworkError} on fetch-level failures
 *   - Throws a clear error if FOLDER9_API_URL / FOLDER9_PSK is missing
 *
 * No business logic, no retries, no caching — callers (WikisService) own those
 * concerns.
 */
@Injectable()
export class Folder9ClientService {
  private baseUrl(): string {
    const u = env.FOLDER9_API_URL;
    if (!u) {
      throw new Error(
        'FOLDER9_API_URL is not configured. Set the environment variable to the folder9 service base URL.',
      );
    }
    return u.replace(/\/$/, '');
  }

  private psk(): string {
    const p = env.FOLDER9_PSK;
    if (!p) {
      throw new Error(
        'FOLDER9_PSK is not configured. Set the environment variable to the folder9 pre-shared key.',
      );
    }
    return p;
  }

  private authHeaderValue(auth: AuthMode): string {
    if (auth === 'psk') {
      return `Bearer ${this.psk()}`;
    }
    return `Bearer ${auth.token}`;
  }

  /**
   * Issue a single request to folder9. Resolves to the parsed JSON body
   * (undefined for empty 2xx responses) or throws a typed error.
   *
   * @typeParam T - Expected parsed response type.
   * @param method - HTTP verb.
   * @param path - Path starting with `/api/...`. Used verbatim in URL and as
   *               the `endpoint` field on thrown errors (stable for logs).
   * @param auth - 'psk' or { token }.
   * @param body - Optional JSON-serializable body for POST/PATCH.
   */
  private async request<T>(
    method: HttpMethod,
    path: string,
    auth: AuthMode,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    const headers: Record<string, string> = {
      [AUTH_HEADER]: this.authHeaderValue(auth),
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (cause) {
      throw new Folder9NetworkError(path, cause);
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      throw new Folder9ApiError(res.status, path, parsed);
    }

    return parsed as T;
  }

  /**
   * Download a binary resource (e.g. a raw file blob). Uses the same auth
   * and error semantics as {@link request}, but returns an ArrayBuffer
   * instead of parsing JSON.
   */
  private async requestBinary(
    path: string,
    auth: AuthMode,
  ): Promise<ArrayBuffer> {
    const url = `${this.baseUrl()}${path}`;
    const init: RequestInit = {
      method: 'GET',
      headers: { [AUTH_HEADER]: this.authHeaderValue(auth) },
    };

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (cause) {
      throw new Folder9NetworkError(path, cause);
    }

    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      throw new Folder9ApiError(res.status, path, parsed);
    }

    return res.arrayBuffer();
  }

  // ---------------------------------------------------------------------
  // Folder management (PSK-protected)
  // ---------------------------------------------------------------------

  /** POST /api/workspaces/{wsId}/folders */
  createFolder(
    wsId: string,
    input: Folder9CreateFolderInput,
  ): Promise<Folder9Folder> {
    return this.request<Folder9Folder>(
      'POST',
      `/api/workspaces/${wsId}/folders`,
      'psk',
      input,
    );
  }

  /** GET /api/workspaces/{wsId}/folders/{folderId} */
  getFolder(wsId: string, folderId: string): Promise<Folder9Folder> {
    return this.request<Folder9Folder>(
      'GET',
      `/api/workspaces/${wsId}/folders/${folderId}`,
      'psk',
    );
  }

  /** PATCH /api/workspaces/{wsId}/folders/{folderId} */
  updateFolder(
    wsId: string,
    folderId: string,
    patch: Folder9UpdateFolderInput,
  ): Promise<Folder9Folder> {
    return this.request<Folder9Folder>(
      'PATCH',
      `/api/workspaces/${wsId}/folders/${folderId}`,
      'psk',
      patch,
    );
  }

  /** DELETE /api/workspaces/{wsId}/folders/{folderId} */
  deleteFolder(wsId: string, folderId: string): Promise<void> {
    return this.request<void>(
      'DELETE',
      `/api/workspaces/${wsId}/folders/${folderId}`,
      'psk',
    );
  }

  // ---------------------------------------------------------------------
  // File read operations (token-protected)
  // ---------------------------------------------------------------------

  /** GET /api/workspaces/{wsId}/folders/{folderId}/tree */
  getTree(
    wsId: string,
    folderId: string,
    token: string,
    opts: { path?: string; recursive?: boolean; ref?: string } = {},
  ): Promise<Folder9TreeEntry[]> {
    const qs = new URLSearchParams();
    if (opts.path) qs.set('path', opts.path);
    if (opts.recursive) qs.set('recursive', 'true');
    if (opts.ref) qs.set('ref', opts.ref);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<Folder9TreeEntry[]>(
      'GET',
      `/api/workspaces/${wsId}/folders/${folderId}/tree${suffix}`,
      { token },
    );
  }

  /** GET /api/workspaces/{wsId}/folders/{folderId}/blob */
  getBlob(
    wsId: string,
    folderId: string,
    token: string,
    path: string,
    ref?: string,
  ): Promise<Folder9BlobResponse> {
    const qs = new URLSearchParams({ path });
    if (ref) qs.set('ref', ref);
    return this.request<Folder9BlobResponse>(
      'GET',
      `/api/workspaces/${wsId}/folders/${folderId}/blob?${qs.toString()}`,
      { token },
    );
  }

  /**
   * GET /api/workspaces/{wsId}/folders/{folderId}/raw
   *
   * Returns the raw bytes of a file (binary-safe). Useful for images/PDFs
   * where base64 round-tripping through /blob would add overhead.
   */
  getRaw(
    wsId: string,
    folderId: string,
    token: string,
    path: string,
    ref?: string,
  ): Promise<ArrayBuffer> {
    const qs = new URLSearchParams({ path });
    if (ref) qs.set('ref', ref);
    return this.requestBinary(
      `/api/workspaces/${wsId}/folders/${folderId}/raw?${qs.toString()}`,
      { token },
    );
  }

  // ---------------------------------------------------------------------
  // Commit (token-protected)
  // ---------------------------------------------------------------------

  /** POST /api/workspaces/{wsId}/folders/{folderId}/commit */
  commit(
    wsId: string,
    folderId: string,
    token: string,
    input: Folder9CommitRequest,
  ): Promise<Folder9CommitResponse> {
    return this.request<Folder9CommitResponse>(
      'POST',
      `/api/workspaces/${wsId}/folders/${folderId}/commit`,
      { token },
      input,
    );
  }

  // ---------------------------------------------------------------------
  // Proposals (token-protected)
  // ---------------------------------------------------------------------

  /** GET /api/workspaces/{wsId}/folders/{folderId}/proposals */
  listProposals(
    wsId: string,
    folderId: string,
    token: string,
    opts: { status?: string } = {},
  ): Promise<Folder9Proposal[]> {
    const suffix = opts.status
      ? `?status=${encodeURIComponent(opts.status)}`
      : '';
    return this.request<Folder9Proposal[]>(
      'GET',
      `/api/workspaces/${wsId}/folders/${folderId}/proposals${suffix}`,
      { token },
    );
  }

  /** GET /api/workspaces/{wsId}/folders/{folderId}/proposals/{pid} */
  getProposal(
    wsId: string,
    folderId: string,
    pid: string,
    token: string,
  ): Promise<Folder9ProposalWithDiff> {
    return this.request<Folder9ProposalWithDiff>(
      'GET',
      `/api/workspaces/${wsId}/folders/${folderId}/proposals/${pid}`,
      { token },
    );
  }

  /**
   * Extract the diff summary for a proposal.
   *
   * folder9 does not expose a dedicated `/proposals/{pid}/diff` endpoint;
   * instead the GET /proposals/{pid} response embeds the `diff_summary`
   * field. This helper keeps the surface consistent for callers.
   */
  async getProposalDiff(
    wsId: string,
    folderId: string,
    pid: string,
    token: string,
  ): Promise<Folder9DiffEntry[]> {
    const proposal = await this.getProposal(wsId, folderId, pid, token);
    return proposal.diff_summary ?? [];
  }

  /** POST /api/workspaces/{wsId}/folders/{folderId}/proposals/{pid}/approve */
  approveProposal(
    wsId: string,
    folderId: string,
    pid: string,
    token: string,
    reviewerId: string,
  ): Promise<void> {
    return this.request<void>(
      'POST',
      `/api/workspaces/${wsId}/folders/${folderId}/proposals/${pid}/approve`,
      { token },
      { reviewer_id: reviewerId },
    );
  }

  /** POST /api/workspaces/{wsId}/folders/{folderId}/proposals/{pid}/reject */
  rejectProposal(
    wsId: string,
    folderId: string,
    pid: string,
    token: string,
    reviewerId: string,
    reason?: string,
  ): Promise<void> {
    const body: { reviewer_id: string; reason?: string } = {
      reviewer_id: reviewerId,
    };
    if (reason !== undefined) {
      body.reason = reason;
    }
    return this.request<void>(
      'POST',
      `/api/workspaces/${wsId}/folders/${folderId}/proposals/${pid}/reject`,
      { token },
      body,
    );
  }
}
