import type { ForwardAttachmentSnapshot } from '@team9/database';

export type ForwardKind = 'single' | 'bundle';

export interface ForwardSourceUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ForwardItemResponse {
  position: number;
  sourceMessageId: string | null;
  sourceChannelId: string;
  sourceChannelName: string | null;
  sourceWorkspaceId: string | null;
  sourceSender: ForwardSourceUser | null;
  sourceCreatedAt: string;
  sourceSeqId: string | null;
  sourceType: 'text' | 'long_text' | 'file' | 'image' | 'forward';
  contentSnapshot: string | null;
  contentAstSnapshot: Record<string, unknown> | null;
  attachmentsSnapshot: ForwardAttachmentSnapshot[];
  canJumpToOriginal: boolean;
  truncated: boolean;
}

export interface ForwardPayload {
  kind: ForwardKind;
  count: number;
  sourceChannelId: string;
  sourceChannelName: string | null;
  truncated: boolean;
  items: ForwardItemResponse[];
}

export interface ForwardMetadata {
  kind: ForwardKind;
  count: number;
  sourceChannelId: string;
  sourceChannelName: string;
  truncated?: boolean;
}

export const FORWARD_CONTENT_SNAPSHOT_LIMIT = 100_000;
export const FORWARD_BUNDLE_LIMIT = 100;
export const FORWARDABLE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'long_text',
  'file',
  'image',
  'forward',
]);
