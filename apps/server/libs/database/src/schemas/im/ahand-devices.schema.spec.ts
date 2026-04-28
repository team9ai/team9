/**
 * Structural smoke tests for the im_ahand_devices Drizzle schema.
 *
 * Mirrors the pattern established by routines.schema.spec.ts — no real
 * database, just type + column surface guards. Migration correctness is
 * verified by `pnpm db:migrate` + psql in the Task 4.1 plan section.
 */
import { describe, it, expect } from '@jest/globals';
import * as schema from '../index.js';

describe('im__ahand_devices schema', () => {
  it('exports ahandDevices table with canonical columns', () => {
    const table = schema.ahandDevices;
    expect(table).toBeDefined();
    // Column accessors must exist for every field callers will read.
    const cols = [
      'id',
      'ownerType',
      'ownerId',
      'hubDeviceId',
      'publicKey',
      'nickname',
      'platform',
      'hostname',
      'status',
      'lastSeenAt',
      'createdAt',
      'revokedAt',
      'capabilities',
    ] as const;
    for (const name of cols) {
      expect(table[name as keyof typeof table]).toBeDefined();
    }
  });

  it('encodes nullable lifecycle fields via types', () => {
    const sample: Partial<schema.AhandDevice> = {
      hostname: null,
      lastSeenAt: null,
      revokedAt: null,
    };
    expect(sample.hostname).toBeNull();
    expect(sample.lastSeenAt).toBeNull();
    expect(sample.revokedAt).toBeNull();
  });

  it('NewAhandDevice allows status/id to be omitted (DB defaults)', () => {
    const row: schema.NewAhandDevice = {
      ownerType: 'user',
      ownerId: '00000000-0000-0000-0000-000000000000',
      hubDeviceId: 'sha256-stub',
      publicKey: 'base64-stub',
      nickname: 'MacBook',
      platform: 'macos',
    };
    expect(row.ownerType).toBe('user');
    expect(row.platform).toBe('macos');
  });

  it('NewAhandDevice allows capabilities to be omitted (DB default empty array)', () => {
    // capabilities defaults to '{}' (empty text[]) in Postgres; callers need not supply it.
    const row: schema.NewAhandDevice = {
      ownerType: 'user',
      ownerId: '00000000-0000-0000-0000-000000000000',
      hubDeviceId: 'sha256-stub',
      publicKey: 'base64-stub',
      nickname: 'MacBook',
      platform: 'macos',
    };
    expect(row.capabilities).toBeUndefined();
  });

  it('AhandDevice.capabilities accepts string array values', () => {
    const row: schema.AhandDevice = {
      id: '00000000-0000-0000-0000-000000000000',
      ownerType: 'user',
      ownerId: '00000000-0000-0000-0000-000000000000',
      hubDeviceId: 'sha256-stub',
      publicKey: 'base64-stub',
      nickname: 'MacBook',
      platform: 'macos',
      hostname: null,
      status: 'active',
      lastSeenAt: null,
      createdAt: new Date(),
      revokedAt: null,
      capabilities: ['exec', 'browser'],
    };
    expect(row.capabilities).toEqual(['exec', 'browser']);
  });
});
