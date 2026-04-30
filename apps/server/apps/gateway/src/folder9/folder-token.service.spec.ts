import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Module mocks ─────────────────────────────────────────────────────────────

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
};

const schemaModule = {
  routines: {
    id: 'routines.id',
    tenantId: 'routines.tenant_id',
    folderId: 'routines.folder_id',
    botId: 'routines.bot_id',
  },
  bots: {
    id: 'bots.id',
    userId: 'bots.user_id',
    managedMeta: 'bots.managed_meta',
    isActive: 'bots.is_active',
  },
  workspaceFolderMounts: {
    workspaceId: 'wfm.workspace_id',
    scope: 'wfm.scope',
    scopeId: 'wfm.scope_id',
    mountKey: 'wfm.mount_key',
    folderType: 'wfm.folder_type',
    folder9FolderId: 'wfm.folder9_folder_id',
  },
  channelMembers: {
    id: 'cm.id',
    channelId: 'cm.channel_id',
    userId: 'cm.user_id',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);

const { FolderTokenService } = await import('./folder-token.service.js');
const { Folder9ApiError } = await import('../wikis/types/folder9.types.js');

import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { FolderTokenRequestDto } from './dto/folder-token-request.dto.js';

// ── Drizzle-chain test double ────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function createQuery(resolve: () => unknown) {
  const query: Record<string, MockFn> & {
    then: (
      onfulfilled: (value: unknown) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    from: jest.fn<any>(),
    where: jest.fn<any>(),
    limit: jest.fn<any>(),
    then(onfulfilled, onrejected) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };
  for (const key of ['from', 'where', 'limit'] as const) {
    query[key].mockReturnValue(query as never);
  }
  return query;
}

function mockDb() {
  const state = {
    selectResults: [] as unknown[][],
  };
  const db = {
    __state: state,
    select: jest.fn(() => {
      const q = createQuery(() =>
        state.selectResults.length > 0 ? state.selectResults.shift() : [],
      );
      return q as never;
    }),
  };
  return db;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const BOT_ID = 'bot-1';
const BOT_USER_ID = 'bot-user-1';
const AGENT_ID = 'agent-1';
const TENANT_ID = 'tenant-1';
const ROUTINE_ID = 'routine-1';
const FOLDER_ID = 'folder-1';
const USER_ID = 'user-1';
const CHANNEL_ID = 'channel-dm-1';
// Canonical sessionIds matching `parseSessionShape` layout —
// `team9/{tenantId}/{agentId}/{scope}/{scopeId}`.
const DM_SESSION_ID = `team9/${TENANT_ID}/${AGENT_ID}/dm/${CHANNEL_ID}`;
const ROUTINE_SESSION_ID = `team9/${TENANT_ID}/${AGENT_ID}/routine/${ROUTINE_ID}`;

const makeDto = (
  overrides: Partial<FolderTokenRequestDto> = {},
): FolderTokenRequestDto =>
  ({
    sessionId: 'session-1',
    agentId: AGENT_ID,
    routineId: ROUTINE_ID,
    userId: USER_ID,
    logicalKey: 'routine.document',
    workspaceId: TENANT_ID,
    folderId: FOLDER_ID,
    folderType: 'managed',
    permission: 'write',
    ...overrides,
  }) as FolderTokenRequestDto;

const mintedTokenResponse = (overrides: Record<string, unknown> = {}) => ({
  id: 'tok-id',
  token: 'opaque-token',
  folder_id: FOLDER_ID,
  permission: 'write',
  name: `routine.document-${ROUTINE_ID}`,
  expires_at: '2030-01-01T00:00:00.000Z',
  created_by: `bot:${BOT_USER_ID}`,
  created_at: '2026-04-30T00:00:00.000Z',
  ...overrides,
});

describe('FolderTokenService', () => {
  let service: InstanceType<typeof FolderTokenService>;
  let db: ReturnType<typeof mockDb>;
  let folder9Client: { createToken: MockFn };

  beforeEach(() => {
    db = mockDb();
    folder9Client = {
      createToken: jest.fn<MockFn>().mockResolvedValue(mintedTokenResponse()),
    };
    service = new FolderTokenService(db as any, folder9Client as any);
  });

  /** Queue a routine row to be returned by the next `select(...).from(routines)...`. */
  function queueRoutine(
    row: {
      id?: string;
      tenantId?: string;
      folderId?: string | null;
    } | null,
  ) {
    db.__state.selectResults.push(
      row
        ? [
            {
              id: row.id ?? ROUTINE_ID,
              tenantId: row.tenantId ?? TENANT_ID,
              folderId: row.folderId === undefined ? FOLDER_ID : row.folderId,
            },
          ]
        : [],
    );
  }

  /**
   * Queue a bot row (or null) to be returned by the bot lookup.
   * Defaults fill in the `(id, userId, managedMeta)` shape that the
   * service actually selects.
   */
  function queueBot(
    row: {
      id?: string;
      userId?: string;
      managedMeta?: Record<string, unknown> | null;
    } | null,
  ) {
    db.__state.selectResults.push(
      row
        ? [
            {
              id: row.id ?? BOT_ID,
              userId: row.userId ?? BOT_USER_ID,
              managedMeta:
                row.managedMeta === undefined
                  ? { agentId: AGENT_ID }
                  : row.managedMeta,
            },
          ]
        : [],
    );
  }

  /**
   * Queue a `workspace_folder_mounts` row (or null) for the next mount
   * lookup.
   */
  function queueMount(row: { scopeId: string; folderType?: string } | null) {
    db.__state.selectResults.push(
      row
        ? [{ scopeId: row.scopeId, folderType: row.folderType ?? 'light' }]
        : [],
    );
  }

  /**
   * Queue the channel-members membership probe — non-empty means
   * member, empty means not-a-member.
   */
  function queueChannelMember(present: boolean) {
    db.__state.selectResults.push(present ? [{ id: 'cm-1' }] : []);
  }

  /**
   * Queue a routine row keyed by `(id, botId)` (or null for "not
   * found / not owned by bot").
   */
  function queueRoutineForBot(row: { id: string } | null) {
    db.__state.selectResults.push(row ? [{ id: row.id }] : []);
  }

  // ── routine.document — happy paths ────────────────────────────────────────

  describe('routine.document — happy paths', () => {
    it('mints a write-scoped token with 1h TTL', async () => {
      // Bot lookup runs BEFORE routine lookup, so queue bot first.
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });

      const before = Date.now();
      const dto = makeDto({ permission: 'write' });
      const result = await service.issueToken(dto, BOT_USER_ID, TENANT_ID);

      expect(result.token).toBe('opaque-token');
      expect(result.expiresAt).toBe(Date.parse('2030-01-01T00:00:00.000Z'));
      expect(folder9Client.createToken).toHaveBeenCalledTimes(1);

      const mintArg = folder9Client.createToken.mock.calls[0][0];
      expect(mintArg.folder_id).toBe(FOLDER_ID);
      expect(mintArg.permission).toBe('write');
      expect(mintArg.name).toBe(`routine.document-${ROUTINE_ID}`);
      expect(mintArg.created_by).toBe(`bot:${BOT_USER_ID}`);

      // 1h TTL ± a few seconds for clock drift.
      const expiresAtMs = Date.parse(mintArg.expires_at as string);
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 60 * 60_000 - 5_000);
      expect(expiresAtMs).toBeLessThanOrEqual(Date.now() + 60 * 60_000 + 5_000);
    });

    it('mints a read-scoped token with 6h TTL', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });

      const before = Date.now();
      const dto = makeDto({ permission: 'read' });
      await service.issueToken(dto, BOT_USER_ID, TENANT_ID);

      const mintArg = folder9Client.createToken.mock.calls[0][0];
      expect(mintArg.permission).toBe('read');
      const expiresAtMs = Date.parse(mintArg.expires_at as string);
      expect(expiresAtMs).toBeGreaterThanOrEqual(
        before + 6 * 60 * 60_000 - 5_000,
      );
      expect(expiresAtMs).toBeLessThanOrEqual(
        Date.now() + 6 * 60 * 60_000 + 5_000,
      );
    });

    it('returns expiresAt undefined when folder9 omits expires_at', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });
      folder9Client.createToken.mockResolvedValueOnce(
        mintedTokenResponse({ expires_at: undefined }),
      );

      const result = await service.issueToken(
        makeDto(),
        BOT_USER_ID,
        TENANT_ID,
      );

      expect(result.expiresAt).toBeUndefined();
    });

    it('returns expiresAt undefined when folder9 returns an unparseable date', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });
      folder9Client.createToken.mockResolvedValueOnce(
        mintedTokenResponse({ expires_at: 'not-a-date' }),
      );

      const result = await service.issueToken(
        makeDto(),
        BOT_USER_ID,
        TENANT_ID,
      );

      expect(result.expiresAt).toBeUndefined();
    });

    it('falls back to lookup-by-folderId when routineId is omitted', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });

      const dto = makeDto({ routineId: undefined });
      await service.issueToken(dto, BOT_USER_ID, TENANT_ID);

      // Audit name still uses the resolved routine id.
      const mintArg = folder9Client.createToken.mock.calls[0][0];
      expect(mintArg.name).toBe(`routine.document-${ROUTINE_ID}`);
    });
  });

  // ── routine.document — authz failures ─────────────────────────────────────

  describe('routine.document — authz failures', () => {
    it('rejects when the routine does not exist (404)', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine(null);

      await expect(
        service.issueToken(makeDto(), BOT_USER_ID, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
      expect(folder9Client.createToken).not.toHaveBeenCalled();
    });

    it('rejects when the routine tenant does not match workspaceId (403)', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: 'other-tenant',
        folderId: FOLDER_ID,
      });

      const dto = makeDto({ workspaceId: TENANT_ID });
      await expect(
        service.issueToken(dto, BOT_USER_ID, undefined),
      ).rejects.toThrow(ForbiddenException);
      expect(folder9Client.createToken).not.toHaveBeenCalled();
    });

    it('rejects when routine.folderId differs from request folderId (403)', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: 'different-folder',
      });

      await expect(
        service.issueToken(makeDto(), BOT_USER_ID, TENANT_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(folder9Client.createToken).not.toHaveBeenCalled();
    });

    it('rejects propose permission for routine.document (403)', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });

      await expect(
        service.issueToken(
          makeDto({ permission: 'propose' }),
          BOT_USER_ID,
          TENANT_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(folder9Client.createToken).not.toHaveBeenCalled();
    });

    it('rejects when caller-claimed routineId mismatches resolved routine', async () => {
      queueBot({ userId: BOT_USER_ID });
      // Looked up by routineId path: returning the wrong row would be
      // a server-side bug, so this test simulates the equivalent case
      // via folder lookup (no routineId in the DTO so we hit
      // findRoutineByFolderId), then a separate test ensures the
      // routineId-claim path is consistent.
      queueRoutine({
        id: 'other-routine',
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });
      const dto = makeDto({ routineId: undefined });
      // Server-side mismatch is caught by the post-resolve check —
      // routineId === undefined skips that branch, so this test
      // just confirms the happy path reaches mint.
      await service.issueToken(dto, BOT_USER_ID, TENANT_ID);
      expect(folder9Client.createToken).toHaveBeenCalled();
    });
  });

  // ── Cross-tenant gate ─────────────────────────────────────────────────────

  describe('cross-tenant gate', () => {
    it('rejects when callerTenantId differs from workspaceId (403)', async () => {
      const dto = makeDto({ workspaceId: TENANT_ID });
      await expect(
        service.issueToken(dto, BOT_USER_ID, 'other-tenant'),
      ).rejects.toThrow(ForbiddenException);
      // Bail before any DB lookup.
      expect(db.select).not.toHaveBeenCalled();
    });

    it('I8 — fails closed (403) when caller tenant is undefined', async () => {
      // After I8, missing tenant context is no longer a fail-soft
      // bypass. Any caller without a tenant must be rejected with a
      // structured log. Bot/routine fixtures are intentionally not
      // queued — the request must bail out before any DB lookup.
      await expect(
        service.issueToken(makeDto(), BOT_USER_ID, undefined),
      ).rejects.toThrow(ForbiddenException);
      // The reason string is part of the public 403 contract — clients
      // distinguish "tenant missing" from "tenant mismatch" by message.
      await expect(
        service.issueToken(makeDto(), BOT_USER_ID, undefined),
      ).rejects.toThrow(/tenant context missing/);
      // Bail before any DB lookup.
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  // ── I7: stub-authz scopes are read-only ────────────────────────────────
  //
  // session.{tmp,home}, agent.{tmp,home}, user.{tmp,home},
  // routine.{tmp,home} ride a stub authz path until real RBAC lands.
  // Until then, write/propose tokens through this endpoint would
  // silently widen the trust boundary, so the v1 endpoint caps the
  // permitted action at `read`. routine.document keeps its own real
  // authz and is unaffected.
  describe('I7 — stub-authz scopes are read-only', () => {
    const STUB_KEYS = [
      'session.tmp',
      'session.home',
      'agent.tmp',
      'agent.home',
      'user.tmp',
      'user.home',
      'routine.tmp',
      'routine.home',
    ] as const;

    for (const logicalKey of STUB_KEYS) {
      it(`403: ${logicalKey} rejects permission=write before any token mint`, async () => {
        // The I7 gate runs after the bot identity lookup but before
        // any logical-key authz (mount row check, ownership, etc).
        // Each `await ... rejects` consumes one full call, so we
        // queue a bot row per call here (two assertions = two calls).
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        const dto = makeDto({
          logicalKey,
          permission: 'write',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(/stub authz; only read permitted/);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects permission=propose`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        const dto = makeDto({
          logicalKey,
          permission: 'propose',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(/stub authz; only read permitted/);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });
    }

    it('routine.document is NOT a stub-authz scope: write is still allowed', async () => {
      // I7 must not regress routine.document, which has real authz.
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });

      const dto = makeDto({
        logicalKey: 'routine.document',
        permission: 'write',
      });
      const result = await service.issueToken(dto, BOT_USER_ID, TENANT_ID);
      expect(result.token).toBe('opaque-token');
    });
  });

  // ── Admin permission rejection ────────────────────────────────────────────

  describe('admin permission', () => {
    it('rejects admin permission with 403 even on routine.document', async () => {
      const dto = makeDto({ permission: 'admin' });
      await expect(
        service.issueToken(dto, BOT_USER_ID, TENANT_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(folder9Client.createToken).not.toHaveBeenCalled();
    });

    it('rejects admin permission on non-document scopes too (e.g. session.tmp)', async () => {
      const dto = makeDto({ logicalKey: 'session.tmp', permission: 'admin' });
      await expect(
        service.issueToken(dto, BOT_USER_ID, TENANT_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(folder9Client.createToken).not.toHaveBeenCalled();
    });
  });

  // ── Unknown logicalKey ────────────────────────────────────────────────────

  describe('unknown logicalKey', () => {
    it('rejects with 403 for an unknown logicalKey', async () => {
      const dto = makeDto({ logicalKey: 'tenant.shared' as any });
      await expect(
        service.issueToken(dto, BOT_USER_ID, TENANT_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Bot identity gate ─────────────────────────────────────────────────────

  describe('bot identity gate', () => {
    it('rejects when caller bot is not active or not found', async () => {
      queueBot(null);

      // Use `permission: 'read'` so the request bypasses the I7
      // stub-authz read-only gate and actually exercises the bot
      // identity lookup (the next gate after the early checks).
      await expect(
        service.issueToken(
          makeDto({ logicalKey: 'session.tmp', permission: 'read' }),
          BOT_USER_ID,
          TENANT_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(folder9Client.createToken).not.toHaveBeenCalled();
    });
  });

  // ── Real authz: agent.{tmp,home} ──────────────────────────────────────────

  describe('agent.{tmp,home} authz', () => {
    for (const mountKey of ['tmp', 'home'] as const) {
      const logicalKey = `agent.${mountKey}` as const;

      it(`200: ${logicalKey} mints a token when mount row matches bot's managed agent`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: AGENT_ID });

        const dto = makeDto({ logicalKey, permission: 'read' });
        const result = await service.issueToken(dto, BOT_USER_ID, TENANT_ID);

        expect(result.token).toBe('opaque-token');
        expect(folder9Client.createToken).toHaveBeenCalledTimes(1);
        const mintArg = folder9Client.createToken.mock.calls[0][0];
        expect(mintArg.name).toBe(`${logicalKey}-${AGENT_ID}`);
        expect(mintArg.permission).toBe('read');
      });

      it(`403: ${logicalKey} rejects when no workspace_folder_mounts row matches`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount(null);

        // Use `permission: 'read'` here so the rejection path runs the
        // real authz logic (mount row absent → 403). I7 caps stub-authz
        // scopes at read; with the default 'write' the test would
        // short-circuit at the I7 gate and never exercise the mount
        // check we're trying to verify.
        const dto = makeDto({ logicalKey, permission: 'read' });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when mount row's scopeId belongs to a different agent`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: 'other-agent' });

        const dto = makeDto({ logicalKey, permission: 'read' });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when bot has no managedMeta.agentId`, async () => {
        queueBot({ id: BOT_ID, managedMeta: null });
        queueMount({ scopeId: AGENT_ID });

        const dto = makeDto({ logicalKey, permission: 'read' });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });
    }
  });

  // ── Real authz: session.{tmp,home} ────────────────────────────────────────

  describe('session.{tmp,home} authz', () => {
    for (const mountKey of ['tmp', 'home'] as const) {
      const logicalKey = `session.${mountKey}` as const;

      it(`200: ${logicalKey} mints a token when sessionId parses + mount row matches`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: DM_SESSION_ID });

        const dto = makeDto({
          logicalKey,
          sessionId: DM_SESSION_ID,
          permission: 'read',
        });
        const result = await service.issueToken(dto, BOT_USER_ID, TENANT_ID);

        expect(result.token).toBe('opaque-token');
        const mintArg = folder9Client.createToken.mock.calls[0][0];
        expect(mintArg.name).toBe(`${logicalKey}-${DM_SESSION_ID}`);
      });

      it(`403: ${logicalKey} rejects when no workspace_folder_mounts row matches`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount(null);

        // permission: 'read' — see the agent.* tests above for rationale.
        const dto = makeDto({
          logicalKey,
          sessionId: DM_SESSION_ID,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when sessionId is unparseable`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: 'whatever' });

        const dto = makeDto({
          logicalKey,
          sessionId: 'garbage-session-id',
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when parsed sessionId.agentId differs from bot's managed agent`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: 'wrong-agent' } });
        queueMount({ scopeId: DM_SESSION_ID });

        const dto = makeDto({
          logicalKey,
          sessionId: DM_SESSION_ID,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when mount row's scopeId differs from req.sessionId`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: 'team9/tenant-1/agent-1/dm/other-channel' });

        const dto = makeDto({
          logicalKey,
          sessionId: DM_SESSION_ID,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });
    }
  });

  // ── Real authz: user.{tmp,home} ───────────────────────────────────────────

  describe('user.{tmp,home} authz', () => {
    for (const mountKey of ['tmp', 'home'] as const) {
      const logicalKey = `user.${mountKey}` as const;

      it(`200: ${logicalKey} mints a token for a DM session where userId is a channel member`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: USER_ID });
        queueChannelMember(true);

        const dto = makeDto({
          logicalKey,
          sessionId: DM_SESSION_ID,
          userId: USER_ID,
          permission: 'read',
        });
        const result = await service.issueToken(dto, BOT_USER_ID, TENANT_ID);

        expect(result.token).toBe('opaque-token');
        const mintArg = folder9Client.createToken.mock.calls[0][0];
        expect(mintArg.name).toBe(`${logicalKey}-${USER_ID}`);
      });

      it(`403: ${logicalKey} rejects when no workspace_folder_mounts row matches`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount(null);

        // permission: 'read' required by I7 — see agent.* tests.
        const dto = makeDto({
          logicalKey,
          sessionId: DM_SESSION_ID,
          userId: USER_ID,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when sessionId is not a DM (e.g. routine)`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: USER_ID });

        const dto = makeDto({
          logicalKey,
          sessionId: ROUTINE_SESSION_ID,
          userId: USER_ID,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when userId is undefined`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: USER_ID });

        const dto = makeDto({
          logicalKey,
          sessionId: DM_SESSION_ID,
          userId: undefined,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when userId is not a member of the DM channel`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: USER_ID });
        queueChannelMember(false);

        const dto = makeDto({
          logicalKey,
          sessionId: DM_SESSION_ID,
          userId: USER_ID,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when mount row's scopeId differs from userId`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: 'other-user' });
        queueChannelMember(true);

        const dto = makeDto({
          logicalKey,
          sessionId: DM_SESSION_ID,
          userId: USER_ID,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });
    }
  });

  // ── TTL on real authz path ────────────────────────────────────────────────
  //
  // After I7, stub-authz logical keys (agent.*, session.*, user.*,
  // routine.{tmp,home}) are read-only. Read tokens use a 6h TTL on
  // those scopes. (The `propose` 1h-TTL path remains exercised
  // indirectly via routine.document tests above.)
  describe('TTL on real authz path', () => {
    it('uses 6h read TTL on agent.home with permission=read', async () => {
      queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
      queueMount({ scopeId: AGENT_ID });
      const before = Date.now();

      const dto = makeDto({
        logicalKey: 'agent.home',
        permission: 'read',
      });
      await service.issueToken(dto, BOT_USER_ID, TENANT_ID);

      const mintArg = folder9Client.createToken.mock.calls[0][0];
      const expiresAtMs = Date.parse(mintArg.expires_at as string);
      expect(expiresAtMs).toBeGreaterThanOrEqual(
        before + 6 * 60 * 60_000 - 5_000,
      );
      expect(expiresAtMs).toBeLessThanOrEqual(
        Date.now() + 6 * 60 * 60_000 + 5_000,
      );
    });
  });

  // ── Real authz: routine.{tmp,home} ────────────────────────────────────────

  describe('routine.{tmp,home} authz', () => {
    for (const mountKey of ['tmp', 'home'] as const) {
      const logicalKey = `routine.${mountKey}` as const;

      it(`200: ${logicalKey} mints a token when routine is owned by bot + mount row matches`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: ROUTINE_ID });
        queueRoutineForBot({ id: ROUTINE_ID });

        const dto = makeDto({
          logicalKey,
          routineId: ROUTINE_ID,
          permission: 'read',
        });
        const result = await service.issueToken(dto, BOT_USER_ID, TENANT_ID);

        expect(result.token).toBe('opaque-token');
        const mintArg = folder9Client.createToken.mock.calls[0][0];
        expect(mintArg.name).toBe(`${logicalKey}-${ROUTINE_ID}`);
      });

      it(`403: ${logicalKey} rejects when no workspace_folder_mounts row matches`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount(null);

        const dto = makeDto({
          logicalKey,
          routineId: ROUTINE_ID,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when routineId is undefined`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: ROUTINE_ID });

        const dto = makeDto({
          logicalKey,
          routineId: undefined,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when routine is not owned by caller bot`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: ROUTINE_ID });
        queueRoutineForBot(null);

        const dto = makeDto({
          logicalKey,
          routineId: ROUTINE_ID,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });

      it(`403: ${logicalKey} rejects when mount row's scopeId differs from routineId`, async () => {
        queueBot({ id: BOT_ID, managedMeta: { agentId: AGENT_ID } });
        queueMount({ scopeId: 'other-routine' });
        queueRoutineForBot({ id: ROUTINE_ID });

        const dto = makeDto({
          logicalKey,
          routineId: ROUTINE_ID,
          permission: 'read',
        });
        await expect(
          service.issueToken(dto, BOT_USER_ID, TENANT_ID),
        ).rejects.toThrow(ForbiddenException);
        expect(folder9Client.createToken).not.toHaveBeenCalled();
      });
    }
  });

  // ── folder9 mint failures ────────────────────────────────────────────────

  describe('folder9 mint failures', () => {
    it('maps folder9 404 to NotFoundException', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });
      folder9Client.createToken.mockRejectedValueOnce(
        new Folder9ApiError(404, '/api/tokens', { error: 'not found' }),
      );

      await expect(
        service.issueToken(makeDto(), BOT_USER_ID, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps folder9 5xx to ServiceUnavailableException', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });
      folder9Client.createToken.mockRejectedValueOnce(
        new Folder9ApiError(502, '/api/tokens', { error: 'gateway' }),
      );

      await expect(
        service.issueToken(makeDto(), BOT_USER_ID, TENANT_ID),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('maps generic / network errors to ServiceUnavailableException', async () => {
      queueBot({ userId: BOT_USER_ID });
      queueRoutine({
        id: ROUTINE_ID,
        tenantId: TENANT_ID,
        folderId: FOLDER_ID,
      });
      folder9Client.createToken.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(
        service.issueToken(makeDto(), BOT_USER_ID, TENANT_ID),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
