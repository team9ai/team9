// apps/server/apps/gateway/src/permissions/__tests__/permissions.service.gate.spec.ts
import { jest } from '@jest/globals';

const grantsFindMany = jest.fn();
const requestsFindFirst = jest.fn();
const updateReturning = jest.fn();

const mockDb = {
  insert: jest.fn(),
  update: jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => ({ returning: updateReturning })),
    })),
  })),
  query: {
    authPermissionGrants: { findMany: grantsFindMany },
    authPermissionRequests: { findFirst: requestsFindFirst },
  },
};

// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@team9/database', () => ({
  DatabaseService: class {
    db = mockDb;
  },
  authPermissionGrants: {},
  authPermissionRequests: {},
  // Provide DATABASE_CONNECTION token and Drizzle helpers used by transitive imports
  DATABASE_CONNECTION: 'DATABASE_CONNECTION',
  eq: jest.fn(),
  and: jest.fn(),
  isNull: jest.fn(),
  desc: jest.fn(),
  // Table refs needed by PermissionsApproverRepository (transitive dep)
  channelMembers: {},
  bots: {},
  routines: {},
  workspaceWikis: {},
  tenantMembers: {},
  inArray: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@team9/database/schemas', () => ({}));

const { PermissionsService } = await import('../permissions.service.js');

const events = { emit: jest.fn() };

describe('PermissionsService.gate', () => {
  let svc: InstanceType<typeof PermissionsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PermissionsService(
      mockDb as never, // db (PostgresJsDatabase via DATABASE_CONNECTION)
      events as never, // EventEmitter2
      undefined as never, // SpellIdService — not used here
      undefined as never, // ApproverRepository — not used here
    );
  });

  it('returns allowed=true when an agent-level grant matches', async () => {
    grantsFindMany.mockResolvedValueOnce([
      {
        id: 'g1',
        subjectKind: 'agent',
        subjectId: 'b1',
        permissionKey: 'messages:send',
        scopeMetadata: {},
        revokedAt: null,
        expiresAt: null,
      },
    ]);
    const r = await svc.gate({
      key: 'messages:send',
      metadata: { channelId: 'c1' },
      ctx: { tenantId: 't1', botId: 'b1', channelId: 'c1' },
    });
    expect(r).toEqual({ allowed: true, via: 'grant', grantId: 'g1' });
  });

  it('chooses the most specific grant first', async () => {
    grantsFindMany.mockResolvedValueOnce([
      // Returned in arbitrary order; service must sort by specificity
      {
        id: 'g-agent',
        subjectKind: 'agent',
        subjectId: 'b1',
        permissionKey: 'tools:invoke',
        scopeMetadata: {},
        revokedAt: null,
        expiresAt: null,
      },
      {
        id: 'g-exec',
        subjectKind: 'execution-session',
        subjectId: 'e1',
        permissionKey: 'tools:invoke',
        scopeMetadata: { toolNames: ['sql'] },
        revokedAt: null,
        expiresAt: null,
      },
    ]);
    const r = await svc.gate({
      key: 'tools:invoke',
      metadata: { toolName: 'sql' },
      ctx: { tenantId: 't1', botId: 'b1', executionId: 'e1' },
    });
    expect(r).toEqual({ allowed: true, via: 'grant', grantId: 'g-exec' });
  });

  it('rejects scope mismatch', async () => {
    grantsFindMany.mockResolvedValueOnce([
      {
        id: 'g1',
        subjectKind: 'agent',
        subjectId: 'b1',
        permissionKey: 'tools:invoke',
        scopeMetadata: { toolNames: ['sql'] },
        revokedAt: null,
        expiresAt: null,
      },
    ]);
    requestsFindFirst.mockResolvedValueOnce(null);
    const r = await svc.gate({
      key: 'tools:invoke',
      metadata: { toolName: 'shell' },
      ctx: { tenantId: 't1', botId: 'b1' },
    });
    expect(r).toEqual({ allowed: false });
  });

  it('falls through to approved_once and consumes it', async () => {
    grantsFindMany.mockResolvedValueOnce([]);
    requestsFindFirst.mockResolvedValueOnce({
      id: 'req1',
      requestedMetadata: { channelId: 'c1' },
      contextChannelId: 'c1',
      contextExecutionId: null,
    });
    updateReturning.mockResolvedValueOnce([
      { id: 'req1', consumedAt: new Date() },
    ]);
    const r = await svc.gate({
      key: 'messages:send',
      metadata: { channelId: 'c1' },
      ctx: { tenantId: 't1', botId: 'b1', channelId: 'c1' },
    });
    expect(r).toEqual({
      allowed: true,
      via: 'approved_once',
      requestId: 'req1',
    });
    expect(events.emit).toHaveBeenCalledWith(
      'permissions.request.consumed',
      expect.objectContaining({ id: 'req1' }),
    );
  });

  it('once-approval lost race -> denies', async () => {
    grantsFindMany.mockResolvedValueOnce([]);
    requestsFindFirst.mockResolvedValueOnce({
      id: 'req1',
      requestedMetadata: { channelId: 'c1' },
      contextChannelId: 'c1',
      contextExecutionId: null,
    });
    updateReturning.mockResolvedValueOnce([]); // another caller already consumed
    const r = await svc.gate({
      key: 'messages:send',
      metadata: { channelId: 'c1' },
      ctx: { tenantId: 't1', botId: 'b1', channelId: 'c1' },
    });
    expect(r).toEqual({ allowed: false });
  });

  it('skips a grant whose expiresAt is in the past', async () => {
    grantsFindMany.mockResolvedValueOnce([
      {
        id: 'g-expired',
        subjectKind: 'agent',
        subjectId: 'b1',
        permissionKey: 'messages:send',
        scopeMetadata: {},
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      },
    ]);
    requestsFindFirst.mockResolvedValueOnce(null);
    const r = await svc.gate({
      key: 'messages:send',
      metadata: {},
      ctx: { tenantId: 't1', botId: 'b1' },
    });
    expect(r).toEqual({ allowed: false });
  });

  it('skips an expired approved_once request', async () => {
    grantsFindMany.mockResolvedValueOnce([]);
    requestsFindFirst.mockResolvedValueOnce({
      id: 'req-expired',
      requestedMetadata: {},
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: null,
      expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
    });
    const r = await svc.gate({
      key: 'messages:send',
      metadata: {},
      ctx: { tenantId: 't1', botId: 'b1' },
    });
    expect(r).toEqual({ allowed: false });
    // Must NOT have tried to consume the expired request
    expect(updateReturning).not.toHaveBeenCalled();
  });

  it('returns allowed=true when a channel-session grant matches', async () => {
    grantsFindMany.mockResolvedValueOnce([
      {
        id: 'g-ch',
        subjectKind: 'channel-session',
        subjectId: 'ch-1',
        permissionKey: 'messages:send',
        scopeMetadata: {},
        revokedAt: null,
        expiresAt: null,
      },
    ]);
    const r = await svc.gate({
      key: 'messages:send',
      metadata: { channelId: 'ch-1' },
      ctx: { tenantId: 't1', botId: 'b1', channelId: 'ch-1' },
    });
    expect(r).toEqual({ allowed: true, via: 'grant', grantId: 'g-ch' });
  });

  it('returns allowed=true when a task grant matches', async () => {
    grantsFindMany.mockResolvedValueOnce([
      {
        id: 'g-task',
        subjectKind: 'task',
        subjectId: 'routine-1',
        permissionKey: 'routine:trigger',
        scopeMetadata: {},
        revokedAt: null,
        expiresAt: null,
      },
    ]);
    const r = await svc.gate({
      key: 'routine:trigger',
      metadata: {},
      ctx: { tenantId: 't1', botId: 'b1', routineId: 'routine-1' },
    });
    expect(r).toEqual({ allowed: true, via: 'grant', grantId: 'g-task' });
  });

  it('denies when channel-session grant exists but channelId not in ctx', async () => {
    grantsFindMany.mockResolvedValueOnce([
      {
        id: 'g-ch',
        subjectKind: 'channel-session',
        subjectId: 'ch-1',
        permissionKey: 'messages:send',
        scopeMetadata: {},
        revokedAt: null,
        expiresAt: null,
      },
    ]);
    requestsFindFirst.mockResolvedValueOnce(null);
    // No channelId in ctx — grant subject 'ch-1' won't match any matcher
    const r = await svc.gate({
      key: 'messages:send',
      metadata: {},
      ctx: { tenantId: 't1', botId: 'b1' }, // no channelId
    });
    expect(r).toEqual({ allowed: false });
  });

  it('approved_once skipped when contextRoutineId does not match calling routineId', async () => {
    grantsFindMany.mockResolvedValueOnce([]);
    requestsFindFirst.mockResolvedValueOnce({
      id: 'req-routine',
      requestedMetadata: {},
      contextChannelId: null,
      contextExecutionId: null,
      contextRoutineId: 'routine-OTHER', // different from ctx.routineId
      expiresAt: null,
    });
    const r = await svc.gate({
      key: 'routine:trigger',
      metadata: {},
      ctx: { tenantId: 't1', botId: 'b1', routineId: 'routine-MINE' },
    });
    // Must deny — contextRoutineId mismatch
    expect(r).toEqual({ allowed: false });
    expect(updateReturning).not.toHaveBeenCalled();
  });

  it('approved_once skipped when contextChannelId does not match calling channelId', async () => {
    grantsFindMany.mockResolvedValueOnce([]);
    requestsFindFirst.mockResolvedValueOnce({
      id: 'req-ch',
      requestedMetadata: {},
      contextChannelId: 'ch-OTHER', // different
      contextExecutionId: null,
      contextRoutineId: null,
      expiresAt: null,
    });
    const r = await svc.gate({
      key: 'messages:send',
      metadata: {},
      ctx: { tenantId: 't1', botId: 'b1', channelId: 'ch-MINE' },
    });
    expect(r).toEqual({ allowed: false });
    expect(updateReturning).not.toHaveBeenCalled();
  });
});
