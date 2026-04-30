/**
 * Type definitions for the folder9 REST API surface that the task-worker
 * actually uses. Subset of the gateway's `apps/server/apps/gateway/src/wikis/
 * types/folder9.types.ts` — kept in sync manually because the task-worker
 * deliberately avoids depending on the gateway package (independent
 * deployment unit). If the wire format changes, update both files.
 *
 * Field names match folder9's JSON wire format exactly (snake_case).
 */

export type Folder9FolderType = 'managed' | 'light';
export type Folder9ApprovalMode = 'auto' | 'review';
export type Folder9OwnerType = 'agent' | 'workspace';
export type Folder9Permission = 'read' | 'propose' | 'write' | 'admin';

/** Response shape for folder CRUD endpoints. */
export interface Folder9Folder {
  id: string;
  name: string;
  type: Folder9FolderType;
  owner_type: Folder9OwnerType;
  owner_id: string;
  workspace_id: string;
  approval_mode: Folder9ApprovalMode;
  created_at: string;
  updated_at: string;
}

/** Input body for POST /api/workspaces/{wsId}/folders. */
export interface Folder9CreateFolderInput {
  name: string;
  type: Folder9FolderType;
  owner_type: Folder9OwnerType;
  owner_id: string;
  approval_mode?: Folder9ApprovalMode;
}

/** One file change inside a commit request body. */
export interface Folder9CommitFile {
  path: string;
  content: string;
  encoding?: 'text' | 'base64';
  action: 'create' | 'update' | 'delete';
}

/** Body for POST .../commit. */
export interface Folder9CommitRequest {
  message: string;
  files: Folder9CommitFile[];
  /** Force the commit through a proposal branch even with write permission. */
  propose?: boolean;
}

/** Response for POST .../commit. */
export interface Folder9CommitResponse {
  commit: string;
  branch: string;
  proposal_id?: string;
}

/** Request body for POST /api/tokens. `expires_at` is RFC3339. */
export interface Folder9CreateTokenRequest {
  folder_id: string;
  permission: Folder9Permission;
  name: string;
  created_by: string;
  expires_at?: string;
}

/** Response body for POST /api/tokens. */
export interface Folder9CreateTokenResponse {
  id: string;
  token: string;
  folder_id: string;
  permission: Folder9Permission;
  name: string;
  expires_at?: string;
  revoked_at?: string;
  created_by: string;
  created_at: string;
}

/** Thrown when folder9 responds with a non-2xx status. */
export class Folder9ApiError extends Error {
  public readonly status: number;
  public readonly endpoint: string;
  public readonly body: unknown;

  constructor(status: number, endpoint: string, body: unknown) {
    super(`folder9 API ${status} at ${endpoint}`);
    this.name = 'Folder9ApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
  }
}

/** Thrown when fetch fails (network error, DNS, timeout). */
export class Folder9NetworkError extends Error {
  public readonly endpoint: string;

  constructor(endpoint: string, cause: unknown, message?: string) {
    super(message ?? `folder9 network error at ${endpoint}`);
    this.name = 'Folder9NetworkError';
    this.endpoint = endpoint;
    this.cause = cause;
  }
}
