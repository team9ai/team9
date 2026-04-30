/**
 * Minimal folder9 HTTP client for the task-worker.
 *
 * Subset of the gateway's `Folder9ClientService` — supports only the three
 * endpoints the executor needs:
 *   - `createFolder` (PSK-auth, used during lazy provisioning)
 *   - `createToken`  (PSK-auth, used to mint write tokens for provisioning
 *                    AND read tokens passed into the agent session)
 *   - `commit`       (token-auth, used to seed SKILL.md on first provision)
 *
 * The task-worker is a separate NestJS app and intentionally does not depend
 * on the gateway package — keeping a thin local client is simpler than
 * extracting the full client into a shared lib. The semantics (auth, error
 * shapes, timeouts) mirror the gateway client so behaviour is consistent.
 */

import { Injectable } from '@nestjs/common';
import { env } from '@team9/shared';

import {
  Folder9ApiError,
  Folder9CommitRequest,
  Folder9CommitResponse,
  Folder9CreateFolderInput,
  Folder9CreateTokenRequest,
  Folder9CreateTokenResponse,
  Folder9Folder,
  Folder9NetworkError,
} from './folder9.types.js';

const AUTH_HEADER = 'Authorization';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type AuthMode = 'psk' | { token: string };

const DEFAULT_TIMEOUT_MS = 15_000;
const LONG_TIMEOUT_MS = 60_000;

@Injectable()
export class Folder9Client {
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

  /** POST /api/tokens — mint a folder-scoped opaque bearer token. */
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

  /** POST /api/workspaces/{wsId}/folders/{folderId}/commit */
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
}
