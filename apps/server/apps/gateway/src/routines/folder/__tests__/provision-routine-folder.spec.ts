import { jest, describe, it, expect, beforeEach } from '@jest/globals';

import {
  provisionFolder9SkillFolder,
  type ProvisionRoutineFolderDeps,
  type RoutineLike,
} from '../provision-routine-folder.js';

// ── helpers ──────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

interface MockFolder9Client {
  createFolder: MockFn;
  commit: MockFn;
  createToken: MockFn;
}

function makeFolder9ClientMock(): MockFolder9Client {
  return {
    createFolder: jest.fn<any>().mockResolvedValue({
      id: 'folder-uuid-1',
      name: 'routine-7f3a2b1c-1111',
      type: 'managed',
      owner_type: 'workspace',
      owner_id: 'ws-1',
      workspace_id: 'ws-1',
      approval_mode: 'auto',
      created_at: '2026-04-27T00:00:00Z',
      updated_at: '2026-04-27T00:00:00Z',
    }),
    commit: jest.fn<any>().mockResolvedValue({
      commit: 'sha-abc',
      branch: 'main',
    }),
    createToken: jest.fn<any>().mockResolvedValue({
      id: 'token-id-1',
      token: 'opaque-token-1',
      folder_id: 'folder-uuid-1',
      permission: 'write',
      name: 'routine-provision',
      created_by: 'routine:7f3a2b1c-1111-2222-3333-444455556666',
      created_at: '2026-04-27T00:00:00Z',
    }),
  };
}

function makeDeps(): {
  folder9Client: MockFolder9Client;
  deps: ProvisionRoutineFolderDeps;
} {
  const folder9Client = makeFolder9ClientMock();
  return {
    folder9Client,
    deps: {
      folder9Client,
      workspaceId: 'ws-1',
      psk: 'psk-1',
    },
  };
}

// ── fixtures ─────────────────────────────────────────────────────────

const baseRoutine: RoutineLike = {
  id: '7f3a2b1c-1111-2222-3333-444455556666',
  title: 'Daily Standup',
  description: 'Send daily standup at 9am',
  documentContent: '# Steps\n1. Check status\n2. Post update',
};

// ── tests ────────────────────────────────────────────────────────────

describe('provisionFolder9SkillFolder', () => {
  let folder9Client: MockFolder9Client;
  let deps: ProvisionRoutineFolderDeps;

  beforeEach(() => {
    const made = makeDeps();
    folder9Client = made.folder9Client;
    deps = made.deps;
  });

  describe('createFolder', () => {
    it('creates a managed folder with auto approval mode and workspace owner', async () => {
      await provisionFolder9SkillFolder(baseRoutine, deps);
      expect(folder9Client.createFolder).toHaveBeenCalledTimes(1);
      const [wsId, input] = folder9Client.createFolder.mock.calls[0];
      expect(wsId).toBe('ws-1');
      expect(input).toEqual({
        name: 'routine-7f3a2b1c-1111',
        type: 'managed',
        owner_type: 'workspace',
        owner_id: 'ws-1',
        approval_mode: 'auto',
      });
    });

    it('derives the slug from the first two UUID segments', async () => {
      await provisionFolder9SkillFolder(
        { ...baseRoutine, id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        deps,
      );
      expect(folder9Client.createFolder.mock.calls[0][1].name).toBe(
        'routine-aaaaaaaa-bbbb',
      );
    });
  });

  describe('SKILL.md composition', () => {
    it('embeds frontmatter with name and description and the documentContent body', async () => {
      await provisionFolder9SkillFolder(baseRoutine, deps);
      const skillMd = folder9Client.commit.mock.calls[0][3].files[0]
        .content as string;
      expect(skillMd).toContain('---\nname: routine-7f3a2b1c-1111\n');
      expect(skillMd).toContain('description: Send daily standup at 9am\n');
      expect(skillMd).toContain('# Steps\n1. Check status\n2. Post update');
      // Frontmatter must come before body
      const frontmatterEnd = skillMd.indexOf('---', 4);
      const bodyStart = skillMd.indexOf('# Steps');
      expect(frontmatterEnd).toBeGreaterThan(0);
      expect(bodyStart).toBeGreaterThan(frontmatterEnd);
    });

    it('falls back to "Generated from routine: <title>" when description is null', async () => {
      await provisionFolder9SkillFolder(
        { ...baseRoutine, description: null },
        deps,
      );
      const skillMd = folder9Client.commit.mock.calls[0][3].files[0]
        .content as string;
      expect(skillMd).toContain(
        'description: Generated from routine: Daily Standup',
      );
    });

    it('falls back to "Generated from routine: <title>" when description is empty/whitespace-only', async () => {
      await provisionFolder9SkillFolder(
        { ...baseRoutine, description: '   ' },
        deps,
      );
      const skillMd = folder9Client.commit.mock.calls[0][3].files[0]
        .content as string;
      expect(skillMd).toContain(
        'description: Generated from routine: Daily Standup',
      );
    });

    it('strips newlines from the description (single-line frontmatter value)', async () => {
      await provisionFolder9SkillFolder(
        {
          ...baseRoutine,
          description: 'Line one\nLine two\nLine three',
        },
        deps,
      );
      const skillMd = folder9Client.commit.mock.calls[0][3].files[0]
        .content as string;
      // newlines replaced with spaces, so the value sits on one line
      expect(skillMd).toContain('description: Line one Line two Line three\n');
      // Body still appears after the closing ---, untouched
      expect(skillMd).toContain('---\n\n# Steps');
    });

    it('trims trailing whitespace from the description', async () => {
      await provisionFolder9SkillFolder(
        { ...baseRoutine, description: '  Padded description  ' },
        deps,
      );
      const skillMd = folder9Client.commit.mock.calls[0][3].files[0]
        .content as string;
      expect(skillMd).toContain('description: Padded description\n');
      expect(skillMd).not.toContain('description:   Padded');
    });

    it('uses an empty body when documentContent is null', async () => {
      await provisionFolder9SkillFolder(
        { ...baseRoutine, documentContent: null },
        deps,
      );
      const skillMd = folder9Client.commit.mock.calls[0][3].files[0]
        .content as string;
      // Ends with the closing frontmatter and a single trailing newline
      expect(skillMd).toMatch(/---\n\n$/);
    });

    it('handles special characters in title for fallback description', async () => {
      await provisionFolder9SkillFolder(
        {
          ...baseRoutine,
          description: null,
          title: 'Routine: weekly\nreport — v2',
        },
        deps,
      );
      const skillMd = folder9Client.commit.mock.calls[0][3].files[0]
        .content as string;
      // Title flows into the description via fallback; the same newline-strip
      // and trim rules apply so frontmatter stays single-line.
      expect(skillMd).toMatch(
        /description: Generated from routine: Routine: weekly report — v2\n/,
      );
    });
  });

  describe('commit', () => {
    it('uses the migration message when documentContent is non-empty', async () => {
      await provisionFolder9SkillFolder(baseRoutine, deps);
      const commitInput = folder9Client.commit.mock.calls[0][3];
      expect(commitInput.message).toBe(
        'Migrate routine 7f3a2b1c-1111 documentContent to SKILL.md',
      );
    });

    it('uses the initial-scaffold message when documentContent is empty', async () => {
      await provisionFolder9SkillFolder(
        { ...baseRoutine, documentContent: '' },
        deps,
      );
      expect(folder9Client.commit.mock.calls[0][3].message).toBe(
        'Initial scaffold for routine 7f3a2b1c-1111',
      );
    });

    it('uses the initial-scaffold message when documentContent is whitespace-only', async () => {
      await provisionFolder9SkillFolder(
        { ...baseRoutine, documentContent: '   \n\t  ' },
        deps,
      );
      expect(folder9Client.commit.mock.calls[0][3].message).toBe(
        'Initial scaffold for routine 7f3a2b1c-1111',
      );
    });

    it('uses the initial-scaffold message when documentContent is null', async () => {
      await provisionFolder9SkillFolder(
        { ...baseRoutine, documentContent: null },
        deps,
      );
      expect(folder9Client.commit.mock.calls[0][3].message).toBe(
        'Initial scaffold for routine 7f3a2b1c-1111',
      );
    });

    it('commits a single SKILL.md file with action=create', async () => {
      await provisionFolder9SkillFolder(baseRoutine, deps);
      const commitInput = folder9Client.commit.mock.calls[0][3];
      expect(commitInput.files).toHaveLength(1);
      expect(commitInput.files[0]).toMatchObject({
        path: 'SKILL.md',
        action: 'create',
        encoding: 'text',
      });
      expect(typeof commitInput.files[0].content).toBe('string');
    });

    it('routes commit through the freshly-minted folder-scoped token', async () => {
      await provisionFolder9SkillFolder(baseRoutine, deps);
      expect(folder9Client.createToken).toHaveBeenCalledTimes(1);
      const tokenReq = folder9Client.createToken.mock.calls[0][0];
      expect(tokenReq).toMatchObject({
        folder_id: 'folder-uuid-1',
        permission: 'write',
      });
      expect(typeof tokenReq.name).toBe('string');
      expect(tokenReq.name.length).toBeGreaterThan(0);
      expect(typeof tokenReq.created_by).toBe('string');
      expect(tokenReq.created_by).toContain(
        '7f3a2b1c-1111-2222-3333-444455556666',
      );

      const [wsId, folderId, token, ,] = folder9Client.commit.mock.calls[0];
      expect(wsId).toBe('ws-1');
      expect(folderId).toBe('folder-uuid-1');
      expect(token).toBe('opaque-token-1');
    });

    it('returns { folderId } from the createFolder response', async () => {
      const result = await provisionFolder9SkillFolder(baseRoutine, deps);
      expect(result).toEqual({ folderId: 'folder-uuid-1' });
    });
  });

  describe('error propagation', () => {
    it('propagates createFolder errors and never calls commit or createToken', async () => {
      folder9Client.createFolder.mockRejectedValueOnce(
        new Error('folder9 down'),
      );
      await expect(
        provisionFolder9SkillFolder(baseRoutine, deps),
      ).rejects.toThrow(/folder9 down/);
      expect(folder9Client.createToken).not.toHaveBeenCalled();
      expect(folder9Client.commit).not.toHaveBeenCalled();
    });

    it('propagates createToken errors and never calls commit (orphan folder retained)', async () => {
      folder9Client.createToken.mockRejectedValueOnce(
        new Error('token mint failed'),
      );
      await expect(
        provisionFolder9SkillFolder(baseRoutine, deps),
      ).rejects.toThrow(/token mint failed/);
      expect(folder9Client.createFolder).toHaveBeenCalledTimes(1);
      expect(folder9Client.commit).not.toHaveBeenCalled();
    });

    it('propagates commit errors (caller decides rollback)', async () => {
      folder9Client.commit.mockRejectedValueOnce(new Error('commit failed'));
      await expect(
        provisionFolder9SkillFolder(baseRoutine, deps),
      ).rejects.toThrow(/commit failed/);
      expect(folder9Client.createFolder).toHaveBeenCalledTimes(1);
      expect(folder9Client.createToken).toHaveBeenCalledTimes(1);
    });
  });
});
