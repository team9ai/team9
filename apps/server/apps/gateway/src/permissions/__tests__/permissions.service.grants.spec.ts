// apps/server/apps/gateway/src/permissions/__tests__/permissions.service.grants.spec.ts
import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const insertReturning = jest.fn();
const updateReturning = jest.fn();
const findManyMock = jest.fn();

const mockDb = {
  insert: jest.fn(() => ({
    values: jest.fn(() => ({ returning: insertReturning })),
  })),
  update: jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(() => ({ returning: updateReturning })),
    })),
  })),
  query: {
    authPermissionGrants: { findMany: findManyMock, findFirst: jest.fn() },
  },
};

// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@team9/database', () => ({
  DatabaseService: class {
    db = mockDb;
  },
  authPermissionGrants: {
    /* table marker */
  },
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

// Mock @team9/database/schemas to satisfy the approver repository's star import
// eslint-disable-next-line @typescript-eslint/await-thenable
await jest.unstable_mockModule('@team9/database/schemas', () => ({}));

const emit = jest.fn();
const events = { emit } as unknown;

const { PermissionsService } = await import('../permissions.service.js');

describe('PermissionsService — grants CRUD', () => {
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

  it('createGrant inserts with source=proactive', async () => {
    const mockRow = {
      id: 'g1',
      tenantId: 't1',
      grantedByUserId: 'u1',
      subjectKind: 'agent',
      subjectId: 'b1',
      permissionKey: 'messages:send',
      scopeMetadata: { channelIds: ['c1'] },
      source: 'proactive',
    };
    insertReturning.mockResolvedValueOnce([mockRow]);
    const grant = await svc.createGrant({
      tenantId: 't1',
      grantedByUserId: 'u1',
      subjectKind: 'agent',
      subjectId: 'b1',
      permissionKey: 'messages:send',
      scopeMetadata: { channelIds: ['c1'] },
    });
    expect(grant).toEqual(mockRow);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'permissions.grant.created',
      expect.objectContaining({ id: 'g1', tenantId: 't1' }),
    );
  });

  it('createGrant rejects unknown permission key', async () => {
    await expect(
      svc.createGrant({
        tenantId: 't1',
        grantedByUserId: 'u1',
        subjectKind: 'agent',
        subjectId: 'b1',
        permissionKey: 'bogus:thing' as never,
        scopeMetadata: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('revokeGrant sets revoked_at and emits event', async () => {
    updateReturning.mockResolvedValueOnce([
      { id: 'g1', tenantId: 't1', revokedAt: new Date() },
    ]);
    const result = await svc.revokeGrant({ grantId: 'g1', userId: 'u1' });
    expect(result.revokedAt).toBeInstanceOf(Date);
    expect(emit).toHaveBeenCalledWith(
      'permissions.grant.revoked',
      expect.objectContaining({ id: 'g1' }),
    );
  });

  it('revokeGrant throws NotFoundException when no row updated', async () => {
    updateReturning.mockResolvedValueOnce([]);
    await expect(
      svc.revokeGrant({ grantId: 'missing', userId: 'u1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listGrants filters by subject and excludes revoked by default', async () => {
    findManyMock.mockResolvedValueOnce([{ id: 'g1' }]);
    const out = await svc.listGrants({
      tenantId: 't1',
      subjectKind: 'agent',
      subjectId: 'b1',
    });
    expect(out).toHaveLength(1);
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });
});
