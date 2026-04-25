/**
 * Wiki feature types — mirror the gateway's DTOs at
 * `apps/server/apps/gateway/src/wikis/dto/*.ts`.
 *
 * The gateway translates folder9's snake_case payloads into camelCase before
 * they reach the client, so every field below matches the backend DTO
 * field-for-field. Keep these in sync when the gateway DTOs change.
 */

export type WikiApprovalMode = "auto" | "review";
export type WikiPermissionLevel = "read" | "propose" | "write";

export type ProposalStatus =
  | "pending"
  | "changes_requested"
  | "approved"
  | "rejected";

export type ProposalAuthorType = "user" | "agent";

export interface WikiDto {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  icon: string | null;
  approvalMode: WikiApprovalMode;
  humanPermission: WikiPermissionLevel;
  agentPermission: WikiPermissionLevel;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface TreeEntryDto {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}

export interface PageDto {
  path: string;
  content: string;
  encoding: "text" | "base64";
  frontmatter: Record<string, unknown>;
  lastCommit: {
    sha: string;
    author: string | null;
    timestamp: string | null;
  } | null;
}

export interface ProposalDto {
  id: string;
  wikiId: string;
  title: string;
  description: string;
  status: ProposalStatus;
  authorId: string;
  authorType: ProposalAuthorType;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface CommitFileInput {
  path: string;
  content: string;
  encoding?: "text" | "base64";
  action: "create" | "update" | "delete";
}

export interface CommitPageInput {
  message: string;
  files: CommitFileInput[];
  propose?: boolean;
}

/**
 * Gateway synthesizes this shape from folder9's
 * `{ commit: string, branch: string, proposal_id?: string }` reply.
 */
export interface CommitPageResponse {
  commit: { sha: string };
  proposal: { id: string; status: ProposalStatus } | null;
}

/**
 * One file's diff as returned by the gateway's
 * `GET /v1/wikis/:wikiId/proposals/:proposalId/diff` endpoint.
 *
 * The field names use folder9's native capitalization (Go exports its
 * struct fields as PascalCase JSON) — the gateway intentionally passes
 * them through untouched so the UI can consume the wire format directly.
 */
export interface ProposalDiffEntry {
  Path: string;
  Status: "added" | "modified" | "deleted";
  OldContent: string;
  NewContent: string;
}
