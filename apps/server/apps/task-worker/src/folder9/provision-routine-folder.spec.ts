import { jest, describe, it, expect, beforeEach } from '@jest/globals';

import {
  provisionFolder9SkillFolder,
  slugifyUuid,
  type ProvisionRoutineFolder9Client,
  type RoutineLike,
} from './provision-routine-folder.js';

describe('slugifyUuid', () => {
  it('takes the first two segments of a UUID', () => {
    expect(slugifyUuid('7f3a2b1c-1111-2222-3333-444455556666')).toBe(
      '7f3a2b1c-1111',
    );
  });

  it('handles shorter inputs gracefully', () => {
    expect(slugifyUuid('abc-def')).toBe('abc-def');
    expect(slugifyUuid('only-one')).toBe('only-one');
  });
});

describe('provisionFolder9SkillFolder', () => {
  let createFolder: jest.Mock;
  let createToken: jest.Mock;
  let commit: jest.Mock;
  let folder9Client: ProvisionRoutineFolder9Client;

  beforeEach(() => {
    createFolder = jest.fn<any>().mockResolvedValue({
      id: 'folder-001',
      name: 'routine-7f3a2b1c-1111',
      type: 'managed',
      owner_type: 'workspace',
      owner_id: 'tenant-001',
      workspace_id: 'tenant-001',
      approval_mode: 'auto',
      created_at: '2026-04-27T00:00:00Z',
      updated_at: '2026-04-27T00:00:00Z',
    });
    createToken = jest.fn<any>().mockResolvedValue({
      id: 'tok-001',
      token: 'opaque-write-token',
      folder_id: 'folder-001',
      permission: 'write',
      name: 'routine-provision',
      created_by: 'routine:r-1',
      created_at: '2026-04-27T00:00:00Z',
    });
    commit = jest
      .fn<any>()
      .mockResolvedValue({ commit: 'sha-001', branch: 'main' });

    folder9Client = {
      createFolder,
      createToken,
      commit,
    } as ProvisionRoutineFolder9Client;
  });

  const baseRoutine: RoutineLike = {
    id: '7f3a2b1c-1111-2222-3333-444455556666',
    title: 'My routine',
    description: 'do the thing',
    documentContent: null,
  };

  it('creates a managed folder, mints a write token, and commits SKILL.md', async () => {
    const result = await provisionFolder9SkillFolder(baseRoutine, {
      folder9Client,
      workspaceId: 'tenant-001',
      psk: '',
    });

    expect(result).toEqual({ folderId: 'folder-001' });
    expect(createFolder).toHaveBeenCalledWith('tenant-001', {
      name: 'routine-7f3a2b1c-1111',
      type: 'managed',
      owner_type: 'workspace',
      owner_id: 'tenant-001',
      approval_mode: 'auto',
    });

    const tokenReq = createToken.mock.calls[0][0] as any;
    expect(tokenReq).toMatchObject({
      folder_id: 'folder-001',
      permission: 'write',
      name: 'routine-provision',
      created_by: 'routine:7f3a2b1c-1111-2222-3333-444455556666',
    });
    // 15-minute TTL.
    expect(tokenReq.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const commitArgs = commit.mock.calls[0];
    expect(commitArgs[0]).toBe('tenant-001');
    expect(commitArgs[1]).toBe('folder-001');
    expect(commitArgs[2]).toBe('opaque-write-token');
    const commitBody = commitArgs[3] as any;
    expect(commitBody.message).toContain('Initial scaffold');
    expect(commitBody.files).toHaveLength(1);
    const skill = commitBody.files[0];
    expect(skill.path).toBe('SKILL.md');
    expect(skill.action).toBe('create');
    expect(skill.encoding).toBe('text');
    expect(skill.content).toContain('name: routine-7f3a2b1c-1111');
    expect(skill.content).toContain('description: do the thing');
  });

  it('emits the migration commit message when documentContent has body', async () => {
    await provisionFolder9SkillFolder(
      { ...baseRoutine, documentContent: 'Body of the routine' },
      { folder9Client, workspaceId: 'tenant-001', psk: '' },
    );

    const commitBody = commit.mock.calls[0][3] as any;
    expect(commitBody.message).toContain('Migrate routine');
    expect(commitBody.files[0].content).toContain('Body of the routine');
  });

  it('falls back to a generated description when routine.description is null', async () => {
    await provisionFolder9SkillFolder(
      { ...baseRoutine, description: null },
      { folder9Client, workspaceId: 'tenant-001', psk: '' },
    );

    const skill = commit.mock.calls[0][3].files[0] as any;
    expect(skill.content).toContain(
      'description: Generated from routine: My routine',
    );
  });

  it('falls back to a generated description when routine.description is whitespace-only', async () => {
    await provisionFolder9SkillFolder(
      { ...baseRoutine, description: '   \n  \r  ' },
      { folder9Client, workspaceId: 'tenant-001', psk: '' },
    );

    const skill = commit.mock.calls[0][3].files[0] as any;
    expect(skill.content).toContain(
      'description: Generated from routine: My routine',
    );
  });

  it('collapses newlines in the description to spaces', async () => {
    await provisionFolder9SkillFolder(
      { ...baseRoutine, description: 'line one\nline two' },
      { folder9Client, workspaceId: 'tenant-001', psk: '' },
    );

    const skill = commit.mock.calls[0][3].files[0] as any;
    expect(skill.content).toContain('description: line one line two');
  });

  it('propagates createFolder errors and never calls createToken or commit', async () => {
    createFolder.mockRejectedValueOnce(new Error('folder9 boom'));

    await expect(
      provisionFolder9SkillFolder(baseRoutine, {
        folder9Client,
        workspaceId: 'tenant-001',
        psk: '',
      }),
    ).rejects.toThrow('folder9 boom');

    expect(createToken).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('propagates createToken errors and never calls commit (orphan folder retained)', async () => {
    createToken.mockRejectedValueOnce(new Error('token mint failed'));

    await expect(
      provisionFolder9SkillFolder(baseRoutine, {
        folder9Client,
        workspaceId: 'tenant-001',
        psk: '',
      }),
    ).rejects.toThrow('token mint failed');

    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('propagates commit errors', async () => {
    commit.mockRejectedValueOnce(new Error('commit boom'));

    await expect(
      provisionFolder9SkillFolder(baseRoutine, {
        folder9Client,
        workspaceId: 'tenant-001',
        psk: '',
      }),
    ).rejects.toThrow('commit boom');
  });
});
