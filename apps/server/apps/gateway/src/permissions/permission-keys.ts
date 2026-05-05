// apps/server/apps/gateway/src/permissions/permission-keys.ts
import type { PermissionsApproverRepository } from './permissions-approver.repository.js';

export type PermissionKey =
  | 'messages:send'
  | 'messages:read'
  | 'tools:invoke'
  | 'routine:trigger'
  | 'wiki:read'
  | 'wiki:write'
  | 'files:read'
  | 'files:write';

export type Risk = 'low' | 'medium' | 'high';

export interface ApproverContext {
  tenantId: string;
  requesterBotId: string;
  permissionKey: PermissionKey;
  metadata: Record<string, unknown>;
  contextChannelId?: string | null;
  contextExecutionId?: string | null;
  contextRoutineId?: string | null;
}

export interface ApproverDeps {
  repo: PermissionsApproverRepository;
}

export interface PermissionKeyDef {
  metadata: Record<string, unknown>; // JSON-Schema-like, validated by class-validator at the controller
  risk: Risk;
  resolveApprovers: (
    ctx: ApproverContext,
    deps: ApproverDeps,
  ) => Promise<string[]>;
  defaultApprovers: 'workspace-admins' | 'bot-owners' | 'none';
  describe: (metadata: Record<string, unknown>) => string;
}

const ChannelScopeSchema = {
  type: 'object',
  properties: {
    channelIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    channelTypes: {
      type: 'array',
      items: { enum: ['public', 'private', 'direct'] },
    },
  },
};

const ToolScopeSchema = {
  type: 'object',
  properties: {
    toolNames: { type: 'array', items: { type: 'string' } },
    targets: { type: 'array', items: { type: 'string' } },
  },
};

const WikiScopeSchema = {
  type: 'object',
  properties: { wikiId: { type: 'string', format: 'uuid' } },
};

const RoutineScopeSchema = {
  type: 'object',
  properties: { routineId: { type: 'string', format: 'uuid' } },
};

const PathScopeSchema = {
  type: 'object',
  properties: { paths: { type: 'array', items: { type: 'string' } } },
};

function pickFirst<T>(arr: T[] | null | undefined): T | undefined {
  return arr && arr.length ? arr[0] : undefined;
}

export const PERMISSION_KEYS: Record<PermissionKey, PermissionKeyDef> = {
  'messages:send': {
    metadata: ChannelScopeSchema,
    risk: 'low',
    resolveApprovers: async (
      { metadata, contextChannelId, tenantId },
      { repo },
    ) => {
      const channelId =
        (metadata.channelId as string | undefined) ??
        pickFirst(metadata.channelIds as string[] | undefined) ??
        contextChannelId ??
        undefined;
      if (!channelId) return [];
      return repo.findChannelOwnersAndAdmins(channelId, tenantId);
    },
    defaultApprovers: 'workspace-admins',
    describe: (m) =>
      `Send messages${
        Array.isArray(m.channelIds) && m.channelIds.length
          ? ` in ${(m.channelIds as string[]).length} channel(s)`
          : ''
      }`,
  },
  'messages:read': {
    metadata: ChannelScopeSchema,
    risk: 'low',
    resolveApprovers: async (ctx, deps) =>
      PERMISSION_KEYS['messages:send'].resolveApprovers(ctx, deps),
    defaultApprovers: 'workspace-admins',
    describe: (m) =>
      `Read message history${
        Array.isArray(m.channelIds)
          ? ` in ${(m.channelIds as string[]).length} channel(s)`
          : ''
      }`,
  },
  'tools:invoke': {
    metadata: ToolScopeSchema,
    risk: 'medium',
    resolveApprovers: async ({ requesterBotId, tenantId }, { repo }) =>
      repo.findBotOwnerAndMentor(requesterBotId, tenantId),
    defaultApprovers: 'workspace-admins',
    describe: (m) => {
      const names = m.toolNames as string[] | undefined;
      return `Invoke tool${names && names.length ? ` (${names.join(', ')})` : ''}`;
    },
  },
  'routine:trigger': {
    metadata: RoutineScopeSchema,
    risk: 'medium',
    resolveApprovers: async (
      { metadata, contextRoutineId, tenantId },
      { repo },
    ) => {
      const id =
        (metadata.routineId as string | undefined) ??
        contextRoutineId ??
        undefined;
      return id ? repo.findRoutineCreatorAndOwner(id, tenantId) : [];
    },
    defaultApprovers: 'workspace-admins',
    describe: (m) =>
      `Trigger routine ${(m.routineId as string | undefined) ?? '(unspecified)'}`,
  },
  'wiki:read': {
    metadata: WikiScopeSchema,
    risk: 'low',
    resolveApprovers: async ({ metadata, tenantId }, { repo }) => {
      const id = metadata.wikiId as string | undefined;
      return id ? repo.findWikiOwners(id, tenantId) : [];
    },
    defaultApprovers: 'workspace-admins',
    describe: (m) =>
      `Read wiki ${(m.wikiId as string | undefined) ?? '(unspecified)'}`,
  },
  'wiki:write': {
    metadata: WikiScopeSchema,
    risk: 'high',
    resolveApprovers: async (ctx, deps) =>
      PERMISSION_KEYS['wiki:read'].resolveApprovers(ctx, deps),
    defaultApprovers: 'workspace-admins',
    describe: (m) =>
      `Write to wiki ${(m.wikiId as string | undefined) ?? '(unspecified)'}`,
  },
  'files:read': {
    metadata: PathScopeSchema,
    risk: 'medium',
    resolveApprovers: async (_ctx, { repo }) =>
      repo.findWorkspaceAdmins(_ctx.tenantId),
    defaultApprovers: 'workspace-admins',
    describe: (m) => {
      const paths = m.paths as string[] | undefined;
      return `Read files${paths && paths.length ? ` (${paths.length} path(s))` : ''}`;
    },
  },
  'files:write': {
    metadata: PathScopeSchema,
    risk: 'high',
    resolveApprovers: async (_ctx, { repo }) =>
      repo.findWorkspaceAdmins(_ctx.tenantId),
    defaultApprovers: 'workspace-admins',
    describe: (m) => {
      const paths = m.paths as string[] | undefined;
      return `Write files${paths && paths.length ? ` (${paths.length} path(s))` : ''}`;
    },
  },
};

export function isPermissionKey(value: string): value is PermissionKey {
  return value in PERMISSION_KEYS;
}
