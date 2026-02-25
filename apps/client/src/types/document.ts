// Document System Types — matching backend gateway/src/documents/documents.service.ts

// ── Identity & Privilege types ──────────────────────────────────────

export interface UserIdentity {
  type: "user";
  id: string;
}

export interface BotIdentity {
  type: "bot";
  id: string;
}

export interface WorkspaceIdentity {
  type: "workspace";
  userType: "bot" | "user" | "all";
}

export type DocumentIdentity = UserIdentity | BotIdentity | WorkspaceIdentity;

export type DocumentRole = "owner" | "editor" | "suggester" | "viewer";

export interface DocumentPrivilege {
  identity: DocumentIdentity;
  role: DocumentRole;
}

export type DocumentSuggestionData = { type: "replace"; content: string };

export type DocumentSuggestionStatus = "pending" | "approved" | "rejected";

// ── Response types ──────────────────────────────────────────────────

export interface DocumentVersionSnapshot {
  id: string;
  versionIndex: number;
  content: string;
  summary: string | null;
  updatedBy: DocumentIdentity;
  createdAt: string;
}

export interface DocumentListItem {
  id: string;
  documentType: string;
  title: string | null;
  createdBy: DocumentIdentity;
  updatedAt: string;
  createdAt: string;
}

export interface DocumentResponse {
  id: string;
  tenantId: string;
  documentType: string;
  title: string | null;
  privileges: DocumentPrivilege[];
  createdBy: DocumentIdentity;
  currentVersion: DocumentVersionSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface VersionResponse {
  id: string;
  documentId: string;
  versionIndex: number;
  content: string;
  summary: string | null;
  updatedBy: DocumentIdentity;
  createdAt: string;
}

export interface SuggestionResponse {
  id: string;
  documentId: string;
  fromVersionId: string;
  suggestedBy: DocumentIdentity;
  data: DocumentSuggestionData;
  summary: string | null;
  status: DocumentSuggestionStatus;
  reviewedBy: DocumentIdentity | null;
  reviewedAt: string | null;
  resultVersionId: string | null;
  createdAt: string;
}

export interface DiffChange {
  count?: number;
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface SuggestionDetailResponse {
  suggestion: SuggestionResponse;
  fromVersion: { versionIndex: number; content: string };
  currentVersion: { versionIndex: number; content: string } | null;
  diff: DiffChange[];
  isOutdated: boolean;
}

// ── DTO types for mutations ─────────────────────────────────────────

export interface CreateDocumentDto {
  documentType: string;
  content: string;
  title?: string;
  privileges?: DocumentPrivilege[];
}

export interface UpdateDocumentDto {
  content: string;
  summary?: string;
}

export interface SubmitSuggestionDto {
  data: DocumentSuggestionData;
  summary?: string;
}

export interface UpdatePrivilegesDto {
  privileges: DocumentPrivilege[];
}
