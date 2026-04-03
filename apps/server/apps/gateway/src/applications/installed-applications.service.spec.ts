import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '@team9/database';
import { InstalledApplicationsService } from './installed-applications.service.js';
import { ApplicationsService } from './applications.service.js';

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

function mockDb() {
  const chain: Record<string, MockFn> = {};
  const methods = [
    'select',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
    'innerJoin',
    'leftJoin',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }
  chain.limit.mockResolvedValue([]);
  chain.returning.mockResolvedValue([]);
  chain.where.mockResolvedValue([]);
  return chain;
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid';
const INSTALLED_BY = 'user-uuid';
const APP_ID = 'base-model-staff';

const INSERTED_RECORD = {
  id: 'installed-app-uuid',
  applicationId: APP_ID,
  tenantId: TENANT_ID,
  installedBy: INSTALLED_BY,
  config: {},
  secrets: {},
  permissions: {},
  status: 'active',
  isActive: true,
  iconUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('InstalledApplicationsService — install', () => {
  let service: InstalledApplicationsService;
  let db: ReturnType<typeof mockDb>;
  let applicationsService: { findById: MockFn };
  let handler: {
    applicationId: string;
    onInstall: MockFn;
    onUninstall: MockFn;
  };

  beforeEach(async () => {
    db = mockDb();

    applicationsService = {
      findById: jest.fn<any>().mockReturnValue({
        id: APP_ID,
        name: 'Base Model Staff',
        type: 'custom',
        singleton: true,
        enabled: true,
      }),
    };

    handler = {
      applicationId: APP_ID,
      onInstall: jest.fn<any>().mockResolvedValue({ config: {} }),
      onUninstall: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstalledApplicationsService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: ApplicationsService, useValue: applicationsService },
        { provide: 'APPLICATION_HANDLERS', useValue: [handler] },
      ],
    }).compile();

    service = module.get<InstalledApplicationsService>(
      InstalledApplicationsService,
    );
  });

  // ── rollback on handler failure ─────────────────────────────────────────────

  it('deletes the inserted record when handler.onInstall() throws', async () => {
    // Singleton check: where() must return chain for .limit() chaining
    db.where.mockReturnValueOnce(db);
    db.limit.mockResolvedValueOnce([]);
    // Insert: return the new record
    db.returning.mockResolvedValueOnce([INSERTED_RECORD]);

    handler.onInstall.mockRejectedValueOnce(new Error('Claw Hive unreachable'));

    await expect(
      service.install(TENANT_ID, INSTALLED_BY, { applicationId: APP_ID }),
    ).rejects.toThrow('Claw Hive unreachable');

    // Should have called delete on the installed_applications table
    expect(db.delete).toHaveBeenCalled();
    expect(db.where).toHaveBeenCalledWith(
      expect.anything(), // eq(schema.installedApplications.id, id)
    );
  });

  it('re-throws the original error after rollback', async () => {
    db.where.mockReturnValueOnce(db);
    db.limit.mockResolvedValueOnce([]);
    db.returning.mockResolvedValueOnce([INSERTED_RECORD]);
    handler.onInstall.mockRejectedValueOnce(new Error('specific error'));

    await expect(
      service.install(TENANT_ID, INSTALLED_BY, { applicationId: APP_ID }),
    ).rejects.toThrow('specific error');
  });

  it('does NOT delete the record on success', async () => {
    // Singleton check: where() returns chain for .limit() chaining
    db.where.mockReturnValueOnce(db);
    db.limit.mockResolvedValueOnce([]);
    db.returning
      .mockResolvedValueOnce([INSERTED_RECORD]) // insert
      .mockResolvedValueOnce([INSERTED_RECORD]); // update with result
    // Update step: where() returns chain for .returning() chaining
    db.where.mockReturnValueOnce(db);

    handler.onInstall.mockResolvedValueOnce({ config: { botIds: ['b1'] } });

    await service.install(TENANT_ID, INSTALLED_BY, { applicationId: APP_ID });

    expect(db.delete).not.toHaveBeenCalled();
  });

  // ── singleton constraint ────────────────────────────────────────────────────

  it('throws ConflictException when app is already installed (singleton)', async () => {
    // Singleton check: where() returns chain for .limit() chaining
    db.where.mockReturnValueOnce(db);
    // Singleton check: existing record found
    db.limit.mockResolvedValueOnce([{ id: 'existing-id' }]);

    await expect(
      service.install(TENANT_ID, INSTALLED_BY, { applicationId: APP_ID }),
    ).rejects.toThrow(ConflictException);

    // Handler should never be called
    expect(handler.onInstall).not.toHaveBeenCalled();
  });

  // ── missing handler ─────────────────────────────────────────────────────────

  it('throws NotFoundException when no handler is registered for the applicationId', async () => {
    await expect(
      service.install(TENANT_ID, INSTALLED_BY, {
        applicationId: 'unknown-app',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('InstalledApplicationsService — uninstall', () => {
  let service: InstalledApplicationsService;
  let db: ReturnType<typeof mockDb>;
  let applicationsService: { findById: MockFn };
  let handler: {
    applicationId: string;
    onInstall: MockFn;
    onUninstall: MockFn;
  };

  beforeEach(async () => {
    db = mockDb();

    applicationsService = {
      findById: jest.fn<any>().mockReturnValue({
        id: APP_ID,
        name: 'Base Model Staff',
        type: 'custom',
        singleton: true,
        enabled: true,
      }),
    };

    handler = {
      applicationId: APP_ID,
      onInstall: jest.fn<any>(),
      onUninstall: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstalledApplicationsService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: ApplicationsService, useValue: applicationsService },
        { provide: 'APPLICATION_HANDLERS', useValue: [handler] },
      ],
    }).compile();

    service = module.get<InstalledApplicationsService>(
      InstalledApplicationsService,
    );
  });

  it('calls onUninstall handler for custom apps', async () => {
    // findByIdWithSecrets uses select().from().where() — where() is terminal
    db.where.mockResolvedValueOnce([
      { ...INSERTED_RECORD, applicationId: APP_ID },
    ]);

    await service.uninstall(INSERTED_RECORD.id, TENANT_ID);

    expect(handler.onUninstall).toHaveBeenCalled();
  });

  it('throws ForbiddenException when uninstalling a managed app', async () => {
    applicationsService.findById.mockReturnValueOnce({
      id: 'some-managed-app',
      name: 'Some Managed App',
      type: 'managed',
      singleton: true,
      enabled: true,
    });
    db.where.mockResolvedValueOnce([
      { ...INSERTED_RECORD, applicationId: 'some-managed-app' },
    ]);

    await expect(
      service.uninstall(INSERTED_RECORD.id, TENANT_ID),
    ).rejects.toThrow(ForbiddenException);

    expect(handler.onUninstall).not.toHaveBeenCalled();
  });
});
