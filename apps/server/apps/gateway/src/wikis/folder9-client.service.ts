import { Injectable } from '@nestjs/common';
import { env } from '@team9/shared';

import {
  Folder9ApiError,
  Folder9BlobResponse,
  Folder9CommitRequest,
  Folder9CommitResponse,
  Folder9CreateFolderInput,
  Folder9CreateTokenRequest,
  Folder9CreateTokenResponse,
  Folder9DiffEntry,
  Folder9Folder,
  Folder9LogEntry,
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
 * Default timeout for metadata endpoints (create/get/update/delete/tree/blob/
 * proposals). Matches OpenclawService's outbound HTTP pattern — a hung TCP
 * connection must not pin the caller indefinitely.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Default timeout for binary/commit endpoints. Commits and raw file downloads
 * can legitimately take longer on large payloads, so we give them more budget.
 */
const LONG_TIMEOUT_MS = 60_000;

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
   * Map a caught fetch error to a `Folder9NetworkError`. AbortError (thrown
   * by `AbortSignal.timeout()`) and TimeoutError get a descriptive timeout
   * message so callers can distinguish them from generic network failures
   * via the error message, while keeping the existing error hierarchy (no
   * new class).
   */
  private toNetworkError(
    path: string,
    timeoutMs: number,
    cause: unknown,
  ): Folder9NetworkError {
    if (
      (cause instanceof Error || cause instanceof DOMException) &&
      (cause.name === 'AbortError' || cause.name === 'TimeoutError')
    ) {
      return new Folder9NetworkError(
        path,
        cause,
        `folder9 request timed out after ${timeoutMs}ms at ${path}`,
      );
    }
    return new Folder9NetworkError(path, cause);
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
   * @param timeoutMs - Per-request timeout in ms. Defaults to
   *                    {@link DEFAULT_TIMEOUT_MS}.
   */
  private async request<T>(
    method: HttpMethod,
    path: string,
    auth: AuthMode,
    body?: unknown,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    const headers: Record<string, string> = {
      [AUTH_HEADER]: this.authHeaderValue(auth),
    };
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (cause) {
      throw this.toNetworkError(path, timeoutMs, cause);
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
   *
   * @param timeoutMs - Per-request timeout in ms. Required — the only
   *                    caller (`getRaw`) supplies the appropriate default
   *                    so this method stays transport-only.
   */
  private async requestBinary(
    path: string,
    auth: AuthMode,
    timeoutMs: number,
  ): Promise<ArrayBuffer> {
    const url = `${this.baseUrl()}${path}`;
    const init: RequestInit = {
      method: 'GET',
      headers: { [AUTH_HEADER]: this.authHeaderValue(auth) },
      signal: AbortSignal.timeout(timeoutMs),
    };

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (cause) {
      throw this.toNetworkError(path, timeoutMs, cause);
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

  /**
   * GET /api/workspaces/{wsId}/folders
   *
   * Lists all folders in a workspace. Used by the orphan-folder GC script
   * (A.10) to enumerate `routine-*` folders for cross-checking against
   * `routines.folder_id`. PSK-protected like the rest of the folder
   * management endpoints.
   */
  listFolders(wsId: string): Promise<Folder9Folder[]> {
    return this.request<Folder9Folder[]>(
      'GET',
      `/api/workspaces/${wsId}/folders`,
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
  // Token minting (PSK-protected)
  // ---------------------------------------------------------------------

  /**
   * POST /api/tokens
   *
   * Mints an opaque folder-scoped token. folder9 treats this as a management
   * endpoint: the PSK is required. The returned `token` string is then used
   * as the Bearer value for file/proposal operations on the specified folder.
   *
   * Callers (WikisService) are responsible for caching tokens and re-minting
   * before expiry — this method is a bare HTTP wrapper.
   */
  createToken(
    input: Folder9CreateTokenRequest,
  ): Promise<Folder9CreateTokenResponse> {
    return this.request<Folder9CreateTokenResponse>(
      'POST',
      `/api/tokens`,
      'psk',
      input,
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
   * where base64 round-tripping through /blob would add overhead. Uses the
   * longer `LONG_TIMEOUT_MS` default since binary transfers can be slow;
   * callers can override via `timeoutMs`.
   */
  getRaw(
    wsId: string,
    folderId: string,
    token: string,
    path: string,
    ref?: string,
    timeoutMs: number = LONG_TIMEOUT_MS,
  ): Promise<ArrayBuffer> {
    const qs = new URLSearchParams({ path });
    if (ref) qs.set('ref', ref);
    return this.requestBinary(
      `/api/workspaces/${wsId}/folders/${folderId}/raw?${qs.toString()}`,
      { token },
      timeoutMs,
    );
  }

  /**
   * GET /api/workspaces/{wsId}/folders/{folderId}/log
   *
   * Returns commit history (most recent first). folder9 only supports this
   * for managed folders — light folders 400 here, surfaced as
   * {@link Folder9ApiError}. Confirmed by reading
   * folder9/internal/api/handlers_files.go (`Log` handler) and
   * folder9/internal/gitops/log.go (`LogEntry` struct).
   *
   * Defaults: `ref = "main"`, `limit = 50` (folder9 server-side default).
   */
  log(
    wsId: string,
    folderId: string,
    token: string,
    opts: { ref?: string; path?: string; limit?: number } = {},
  ): Promise<Folder9LogEntry[]> {
    const qs = new URLSearchParams();
    if (opts.ref) qs.set('ref', opts.ref);
    if (opts.path) qs.set('path', opts.path);
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<Folder9LogEntry[]>(
      'GET',
      `/api/workspaces/${wsId}/folders/${folderId}/log${suffix}`,
      { token },
    );
  }

  // ---------------------------------------------------------------------
  // Commit (token-protected)
  // ---------------------------------------------------------------------

  /**
   * POST /api/workspaces/{wsId}/folders/{folderId}/commit
   *
   * Commits can legitimately take longer than a metadata call (folder9 has to
   * walk trees, write objects, and fsync), so we default to
   * `LONG_TIMEOUT_MS` — still bounded, still survives a hung connection.
   */
  commit(
    wsId: string,
    folderId: string,
    token: string,
    input: Folder9CommitRequest,
    timeoutMs: number = LONG_TIMEOUT_MS,
  ): Promise<Folder9CommitResponse> {
    return this.request<Folder9CommitResponse>(
      'POST',
      `/api/workspaces/${wsId}/folders/${folderId}/commit`,
      { token },
      input,
      timeoutMs,
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
