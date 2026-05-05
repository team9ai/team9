// apps/server/apps/gateway/src/permissions/__tests__/permissions-keys.spec.ts
//
// Unit tests for each PERMISSION_KEYS entry's resolveApprovers function.
// Each test stubs the repo and asserts the correct repo method is called
// with the correct arguments.

import { jest } from '@jest/globals';
import { PERMISSION_KEYS } from '../permission-keys.js';
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
