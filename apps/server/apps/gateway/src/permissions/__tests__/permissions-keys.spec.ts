// apps/server/apps/gateway/src/permissions/__tests__/permissions-keys.spec.ts
//
// Unit tests for each PERMISSION_KEYS entry's resolveApprovers function.
// Each test stubs the repo and asserts the correct repo method is called
// with the correct arguments.

import { jest } from '@jest/globals';
import { PERMISSION_KEYS, isPermissionKey } from '../permission-keys.js';
import type { ApproverContext, ApproverDeps } from '../permission-keys.js';

function makeRepo() {
  return {
    findChannelOwnersAndAdmins: jest
      .fn<() => Promise<string[]>>()
      .mockResolvedValue([]),
    findBotOwnerAndMentor: jest
      .fn<() => Promise<string[]>>()
      .mockResolvedValue([]),
    findRoutineCreatorAndOwner: jest
      .fn<() => Promise<string[]>>()
      .mockResolvedValue([]),
    findWikiOwners: jest.fn<() => Promise<string[]>>().mockResolvedValue([]),
    findWorkspaceOwners: jest
      .fn<() => Promise<string[]>>()
      .mockResolvedValue([]),
    findWorkspaceAdmins: jest
      .fn<() => Promise<string[]>>()
      .mockResolvedValue([]),
  };
}

const BASE_CTX: ApproverContext = {
  tenantId: 't1',
  requesterBotId: 'bot-1',
  permissionKey: 'messages:send',
  metadata: {},
  contextChannelId: null,
  contextExecutionId: null,
  contextRoutineId: null,
};

describe('PERMISSION_KEYS[messages:send].resolveApprovers', () => {
  it('calls findChannelOwnersAndAdmins with channelId from metadata.channelId', async () => {
    const repo = makeRepo();
    repo.findChannelOwnersAndAdmins.mockResolvedValueOnce(['u-admin']);
    const result = await PERMISSION_KEYS['messages:send'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'messages:send',
        metadata: { channelId: 'ch-1' },
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findChannelOwnersAndAdmins).toHaveBeenCalledWith('ch-1', 't1');
    expect(result).toContain('u-admin');
  });

  it('calls findChannelOwnersAndAdmins with channelId from metadata.channelIds[0]', async () => {
    const repo = makeRepo();
    repo.findChannelOwnersAndAdmins.mockResolvedValueOnce(['u-admin']);
    await PERMISSION_KEYS['messages:send'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'messages:send',
        metadata: { channelIds: ['ch-first', 'ch-second'] },
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findChannelOwnersAndAdmins).toHaveBeenCalledWith(
      'ch-first',
      't1',
    );
  });

  it('calls findChannelOwnersAndAdmins with contextChannelId when metadata has no channelId', async () => {
    const repo = makeRepo();
    repo.findChannelOwnersAndAdmins.mockResolvedValueOnce([]);
    await PERMISSION_KEYS['messages:send'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'messages:send',
        metadata: {},
        contextChannelId: 'ctx-ch',
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findChannelOwnersAndAdmins).toHaveBeenCalledWith(
      'ctx-ch',
      't1',
    );
  });

  it('returns [] when no channelId in metadata or context', async () => {
    const repo = makeRepo();
    const result = await PERMISSION_KEYS['messages:send'].resolveApprovers(
      { ...BASE_CTX, permissionKey: 'messages:send', metadata: {} },
      { repo } as ApproverDeps,
    );
    expect(repo.findChannelOwnersAndAdmins).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe('PERMISSION_KEYS[messages:read].resolveApprovers', () => {
  it('delegates to messages:send resolveApprovers (same channel logic)', async () => {
    const repo = makeRepo();
    repo.findChannelOwnersAndAdmins.mockResolvedValueOnce(['u-read-admin']);
    const result = await PERMISSION_KEYS['messages:read'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'messages:read',
        metadata: { channelId: 'ch-2' },
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findChannelOwnersAndAdmins).toHaveBeenCalledWith('ch-2', 't1');
    expect(result).toContain('u-read-admin');
  });
});

describe('PERMISSION_KEYS[tools:invoke].resolveApprovers', () => {
  it('calls findBotOwnerAndMentor with requesterBotId and tenantId', async () => {
    const repo = makeRepo();
    repo.findBotOwnerAndMentor.mockResolvedValueOnce(['u-owner', 'u-mentor']);
    const result = await PERMISSION_KEYS['tools:invoke'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'tools:invoke',
        requesterBotId: 'bot-42',
        tenantId: 't1',
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findBotOwnerAndMentor).toHaveBeenCalledWith('bot-42', 't1');
    expect(result).toEqual(['u-owner', 'u-mentor']);
  });
});

describe('PERMISSION_KEYS[routine:trigger].resolveApprovers', () => {
  it('calls findRoutineCreatorAndOwner with routineId and tenantId', async () => {
    const repo = makeRepo();
    repo.findRoutineCreatorAndOwner.mockResolvedValueOnce(['u-creator']);
    const result = await PERMISSION_KEYS['routine:trigger'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'routine:trigger',
        metadata: { routineId: 'rt-1' },
        tenantId: 't1',
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findRoutineCreatorAndOwner).toHaveBeenCalledWith('rt-1', 't1');
    expect(result).toContain('u-creator');
  });

  it('calls findRoutineCreatorAndOwner with contextRoutineId when metadata lacks routineId', async () => {
    const repo = makeRepo();
    repo.findRoutineCreatorAndOwner.mockResolvedValueOnce(['u-creator']);
    await PERMISSION_KEYS['routine:trigger'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'routine:trigger',
        metadata: {},
        contextRoutineId: 'ctx-rt',
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findRoutineCreatorAndOwner).toHaveBeenCalledWith(
      'ctx-rt',
      't1',
    );
  });

  it('returns [] when no routineId in metadata or context', async () => {
    const repo = makeRepo();
    const result = await PERMISSION_KEYS['routine:trigger'].resolveApprovers(
      { ...BASE_CTX, permissionKey: 'routine:trigger', metadata: {} },
      { repo } as ApproverDeps,
    );
    expect(repo.findRoutineCreatorAndOwner).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe('PERMISSION_KEYS[wiki:read].resolveApprovers', () => {
  it('calls findWikiOwners with wikiId and tenantId', async () => {
    const repo = makeRepo();
    repo.findWikiOwners.mockResolvedValueOnce(['u-wiki-owner']);
    const result = await PERMISSION_KEYS['wiki:read'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'wiki:read',
        metadata: { wikiId: 'wiki-1' },
        tenantId: 't1',
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findWikiOwners).toHaveBeenCalledWith('wiki-1', 't1');
    expect(result).toContain('u-wiki-owner');
  });

  it('returns [] when no wikiId in metadata', async () => {
    const repo = makeRepo();
    const result = await PERMISSION_KEYS['wiki:read'].resolveApprovers(
      { ...BASE_CTX, permissionKey: 'wiki:read', metadata: {} },
      { repo } as ApproverDeps,
    );
    expect(repo.findWikiOwners).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe('PERMISSION_KEYS[wiki:write].resolveApprovers', () => {
  it('delegates to wiki:read resolveApprovers (same wiki owner logic)', async () => {
    const repo = makeRepo();
    repo.findWikiOwners.mockResolvedValueOnce(['u-wiki-owner']);
    const result = await PERMISSION_KEYS['wiki:write'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'wiki:write',
        metadata: { wikiId: 'wiki-2' },
        tenantId: 't1',
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findWikiOwners).toHaveBeenCalledWith('wiki-2', 't1');
    expect(result).toContain('u-wiki-owner');
  });
});

describe('PERMISSION_KEYS[files:read].resolveApprovers', () => {
  it('calls findWorkspaceAdmins with tenantId', async () => {
    const repo = makeRepo();
    repo.findWorkspaceAdmins.mockResolvedValueOnce(['u-ws-admin']);
    const result = await PERMISSION_KEYS['files:read'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'files:read',
        tenantId: 'tenant-99',
        metadata: {},
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findWorkspaceAdmins).toHaveBeenCalledWith('tenant-99');
    expect(result).toContain('u-ws-admin');
  });
});

describe('PERMISSION_KEYS[files:write].resolveApprovers', () => {
  it('calls findWorkspaceAdmins with tenantId', async () => {
    const repo = makeRepo();
    repo.findWorkspaceAdmins.mockResolvedValueOnce(['u-ws-admin']);
    const result = await PERMISSION_KEYS['files:write'].resolveApprovers(
      {
        ...BASE_CTX,
        permissionKey: 'files:write',
        tenantId: 'tenant-77',
        metadata: {},
      },
      { repo } as ApproverDeps,
    );
    expect(repo.findWorkspaceAdmins).toHaveBeenCalledWith('tenant-77');
    expect(result).toContain('u-ws-admin');
  });
});

// ---------------------------------------------------------------------------
// isPermissionKey
// ---------------------------------------------------------------------------

describe('isPermissionKey', () => {
  it('returns true for a valid permission key', () => {
    expect(isPermissionKey('messages:send')).toBe(true);
  });

  it('returns false for an unknown key', () => {
    expect(isPermissionKey('bogus:key')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isPermissionKey('')).toBe(false);
  });

  it('returns false for an arbitrary string that is not a key', () => {
    expect(isPermissionKey('not:a:key')).toBe(false);
    expect(isPermissionKey('messages')).toBe(false);
  });

  it('returns true for each of the 8 registered keys', () => {
    const keys = [
      'messages:send',
      'messages:read',
      'tools:invoke',
      'routine:trigger',
      'wiki:read',
      'wiki:write',
      'files:read',
      'files:write',
    ];
    for (const key of keys) {
      expect(isPermissionKey(key)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// describe() for each of the 8 keys
// ---------------------------------------------------------------------------

describe('PERMISSION_KEYS[messages:send].describe', () => {
  it('includes channel count when channelIds is provided', () => {
    const result = PERMISSION_KEYS['messages:send'].describe({
      channelIds: ['c1', 'c2'],
    });
    expect(result).toBeTruthy();
    expect(result).toContain('2');
  });

  it('returns a non-empty string with empty metadata', () => {
    const result = PERMISSION_KEYS['messages:send'].describe({});
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('PERMISSION_KEYS[messages:read].describe', () => {
  it('includes channel count when channelIds is provided', () => {
    const result = PERMISSION_KEYS['messages:read'].describe({
      channelIds: ['c1'],
    });
    expect(result).toBeTruthy();
    expect(result).toContain('1');
  });

  it('returns a non-empty string with empty metadata', () => {
    const result = PERMISSION_KEYS['messages:read'].describe({});
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('PERMISSION_KEYS[tools:invoke].describe', () => {
  it('includes tool names when toolNames is provided', () => {
    const result = PERMISSION_KEYS['tools:invoke'].describe({
      toolNames: ['sql', 'shell'],
    });
    expect(result).toContain('sql');
    expect(result).toContain('shell');
  });

  it('returns a non-empty string with empty metadata', () => {
    const result = PERMISSION_KEYS['tools:invoke'].describe({});
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('PERMISSION_KEYS[routine:trigger].describe', () => {
  it('includes routineId when provided', () => {
    const result = PERMISSION_KEYS['routine:trigger'].describe({
      routineId: 'rt-abc',
    });
    expect(result).toContain('rt-abc');
  });

  it('mentions unspecified when routineId is missing', () => {
    const result = PERMISSION_KEYS['routine:trigger'].describe({});
    expect(result).toContain('unspecified');
  });
});

describe('PERMISSION_KEYS[wiki:read].describe', () => {
  it('includes wikiId when provided', () => {
    const result = PERMISSION_KEYS['wiki:read'].describe({ wikiId: 'wiki-99' });
    expect(result).toContain('wiki-99');
  });

  it('mentions unspecified when wikiId is missing', () => {
    const result = PERMISSION_KEYS['wiki:read'].describe({});
    expect(result).toContain('unspecified');
  });
});

describe('PERMISSION_KEYS[wiki:write].describe', () => {
  it('includes wikiId when provided', () => {
    const result = PERMISSION_KEYS['wiki:write'].describe({
      wikiId: 'wiki-77',
    });
    expect(result).toContain('wiki-77');
  });

  it('mentions unspecified when wikiId is missing', () => {
    const result = PERMISSION_KEYS['wiki:write'].describe({});
    expect(result).toContain('unspecified');
  });
});

describe('PERMISSION_KEYS[files:read].describe', () => {
  it('includes path count when paths is provided', () => {
    const result = PERMISSION_KEYS['files:read'].describe({
      paths: ['/a', '/b', '/c'],
    });
    expect(result).toContain('3');
  });

  it('returns a non-empty string with empty metadata', () => {
    const result = PERMISSION_KEYS['files:read'].describe({});
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('PERMISSION_KEYS[files:write].describe', () => {
  it('includes path count when paths is provided', () => {
    const result = PERMISSION_KEYS['files:write'].describe({
      paths: ['/tmp/x'],
    });
    expect(result).toContain('1');
  });

  it('returns a non-empty string with empty metadata', () => {
    const result = PERMISSION_KEYS['files:write'].describe({});
    expect(result.length).toBeGreaterThan(0);
  });
});
