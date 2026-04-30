import { jest, describe, it, expect, beforeEach } from '@jest/globals';

import { ensureRoutineFolder } from './ensure-routine-folder.js';
import type { ProvisionRoutineFolderDeps } from './provision-routine-folder.js';

// Tiny stub that mimics the Drizzle-postgres transaction-aware select
// chain used by ensureRoutineFolder. Each test seeds one row to be
// returned from `tx.select(...).from(...).where(...).for('update')`.
function makeTx(row: any | undefined) {
  const tx: any = {};
  tx.select = jest.fn<any>().mockReturnValue(tx);
  tx.from = jest.fn<any>().mockReturnValue(tx);
  tx.where = jest.fn<any>().mockReturnValue(tx);
  tx.for = jest.fn<any>().mockResolvedValue(row === undefined ? [] : [row]);
  tx.update = jest.fn<any>().mockReturnValue(tx);
  tx.set = jest.fn<any>().mockReturnValue(tx);
  return tx;
}

function makeDb(row: any | undefined) {
  const tx = makeTx(row);
  const db: any = {
    _tx: tx,
    transaction: jest.fn<any>().mockImplementation((fn: any) => fn(tx)),
  };
  return db;
}

const baseProvisionDeps: ProvisionRoutineFolderDeps = {
  folder9Client: {
    createFolder: jest.fn<any>(),
    createToken: jest.fn<any>(),
    commit: jest.fn<any>(),
  } as any,
  workspaceId: 'tenant-001',
  psk: '',
};

describe('ensureRoutineFolder (task-worker copy)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when no routine row matches', async () => {
    const db = makeDb(undefined);
    const provision = jest.fn<any>();

    await expect(
      ensureRoutineFolder('missing-id', {
        db,
        provisionDeps: baseProvisionDeps,
        provision,
      }),
    ).rejects.toThrow('routine missing-id not found');

    expect(provision).not.toHaveBeenCalled();
    expect(db._tx.update).not.toHaveBeenCalled();
  });

  it('takes the fast path when folderId is already populated', async () => {
    const row = {
      id: 'r-1',
      title: 'T',
      description: 'D',
      tenantId: 'tenant-001',
      folderId: 'pre-existing-folder',
    };
    const db = makeDb(row);
    const provision = jest.fn<any>();

    const result = await ensureRoutineFolder('r-1', {
      db,
      provisionDeps: baseProvisionDeps,
      provision,
    });

    expect(result).toBe(row);
    expect(provision).not.toHaveBeenCalled();
    expect(db._tx.update).not.toHaveBeenCalled();
  });

  it('takes the slow path: provisions, persists folderId, returns merged row', async () => {
    const row = {
      id: 'r-2',
      title: 'T',
      description: 'D',
      tenantId: 'tenant-001',
      folderId: null,
    };
    const db = makeDb(row);
    const provision = jest
      .fn<any>()
      .mockResolvedValueOnce({ folderId: 'newly-minted' });

    const result = await ensureRoutineFolder('r-2', {
      db,
      provisionDeps: baseProvisionDeps,
      provision,
    });

    expect(result.folderId).toBe('newly-minted');
    expect(provision).toHaveBeenCalledWith(
      {
        id: 'r-2',
        title: 'T',
        description: 'D',
        documentContent: null,
      },
      baseProvisionDeps,
    );
    // Persists the new folderId.
    expect(db._tx.update).toHaveBeenCalled();
    expect(db._tx.set).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'newly-minted' }),
    );
  });

  it('re-throws provision errors as-is (no exception rewriting)', async () => {
    const row = {
      id: 'r-3',
      title: 'T',
      description: 'D',
      tenantId: 'tenant-001',
      folderId: null,
    };
    const db = makeDb(row);
    const provision = jest
      .fn<any>()
      .mockRejectedValueOnce(new Error('folder9 down'));

    await expect(
      ensureRoutineFolder('r-3', {
        db,
        provisionDeps: baseProvisionDeps,
        provision,
      }),
    ).rejects.toThrow('folder9 down');

    // Update must NOT happen on the failed slow path.
    expect(db._tx.update).not.toHaveBeenCalled();
  });

  it('uses the default provisioner when no override is supplied', async () => {
    const row = {
      id: 'r-4',
      title: 'T',
      description: 'D',
      tenantId: 'tenant-001',
      folderId: 'already-have-it',
    };
    const db = makeDb(row);

    const result = await ensureRoutineFolder('r-4', {
      db,
      provisionDeps: baseProvisionDeps,
    });

    expect(result.folderId).toBe('already-have-it');
  });
});
