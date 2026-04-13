/**
 * Type definitions for the folder9 REST API.
 *
 * Field names match folder9's JSON wire format exactly (snake_case, see
 * folder9/internal/api/handlers_folders.go and handlers_proposals.go). Do not
 * translate to camelCase here — the Folder9ClientService is a thin HTTP
 * wrapper and any mapping belongs in the calling layer.
 */

export type Folder9FolderType = 'managed' | 'light';
export type Folder9ApprovalMode = 'auto' | 'review';
export type Folder9OwnerType = 'agent' | 'workspace';
export type Folder9PrincipalType = 'agent' | 'user';
export type Folder9Permission = 'read' | 'propose' | 'write' | 'admin';
export type Folder9ProposalStatus =
  | 'pending'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'merged';

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

/** Patch body for PATCH /api/workspaces/{wsId}/folders/{folderId}. */
export interface Folder9UpdateFolderInput {
  name?: string;
  approval_mode?: Folder9ApprovalMode;
}

/** One entry in the response of GET .../tree. */
export interface Folder9TreeEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
}

/**
 * Response shape for GET .../blob.
 *
 * folder9 auto-detects UTF-8: valid UTF-8 content is returned as-is with
 * encoding "text"; binary content is base64-encoded with encoding "base64".
 */
export interface Folder9BlobResponse {
  path: string;
  size: number;
  content: string;
  encoding: 'text' | 'base64';
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

/**
 * Response for POST .../commit.
 *
 * Direct commits (write permission, propose=false) return {commit, branch}.
 * Proposal commits (review mode or propose=true) also include proposal_id.
 */
export interface Folder9CommitResponse {
  commit: string;
  branch: string;
  proposal_id?: string;
}

/** Diff entry for one file between two refs. */
export interface Folder9DiffEntry {
  Path: string;
  Status: 'added' | 'modified' | 'deleted';
  OldContent: string;
  NewContent: string;
}

/** Proposal shape returned by list endpoints. */
export interface Folder9Proposal {
  id: string;
  folder_id: string;
  branch_name: string;
  title: string;
  description: string;
  status: Folder9ProposalStatus;
  author_type: Folder9PrincipalType;
  author_id: string;
  reviewed_by?: string | null;
  created_at: string;
}

/** Proposal shape returned by GET /proposals/{pid} — includes diff summary. */
export interface Folder9ProposalWithDiff extends Folder9Proposal {
  diff_summary?: Folder9DiffEntry[];
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

/** Thrown when the underlying fetch call fails (network error, DNS, etc). */
export class Folder9NetworkError extends Error {
  public readonly endpoint: string;

  constructor(endpoint: string, cause: unknown) {
    super(`folder9 network error at ${endpoint}`);
    this.name = 'Folder9NetworkError';
    this.endpoint = endpoint;
    this.cause = cause;
  }
}
