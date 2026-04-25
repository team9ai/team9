import { describe, it, expect } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  resolveWikiPermission,
  requirePermission,
} from '../utils/permission.js';

const baseWiki = {
  humanPermission: 'write' as const,
  agentPermission: 'read' as const,
};

describe('resolveWikiPermission', () => {
  it('returns humanPermission for a human user', () => {
    expect(resolveWikiPermission(baseWiki, { id: 'u1', isAgent: false })).toBe(
      'write',
    );
  });

  it('returns agentPermission for an agent user', () => {
    expect(resolveWikiPermission(baseWiki, { id: 'a1', isAgent: true })).toBe(
      'read',
    );
  });
});

describe('requirePermission', () => {
  it('passes when human user has exactly the required perm', () => {
    expect(() =>
      requirePermission(
        { humanPermission: 'propose', agentPermission: 'read' },
        { id: 'u', isAgent: false },
        'propose',
      ),
    ).not.toThrow();
  });

  it('passes when human user has a higher perm than required', () => {
    expect(() =>
      requirePermission(
        { humanPermission: 'write', agentPermission: 'read' },
        { id: 'u', isAgent: false },
        'read',
      ),
    ).not.toThrow();
  });

  it('throws ForbiddenException when human user is below required perm', () => {
    expect(() =>
      requirePermission(
        { humanPermission: 'read', agentPermission: 'read' },
        { id: 'u', isAgent: false },
        'write',
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when human user lacks intermediate perm', () => {
    expect(() =>
      requirePermission(
        { humanPermission: 'read', agentPermission: 'write' },
        { id: 'u', isAgent: false },
        'propose',
      ),
    ).toThrow(ForbiddenException);
  });

  it('passes when agent has exactly the required perm', () => {
    expect(() =>
      requirePermission(
        { humanPermission: 'read', agentPermission: 'propose' },
        { id: 'a', isAgent: true },
        'propose',
      ),
    ).not.toThrow();
  });

  it('passes when agent has a higher perm than required', () => {
    expect(() =>
      requirePermission(
        { humanPermission: 'read', agentPermission: 'write' },
        { id: 'a', isAgent: true },
        'propose',
      ),
    ).not.toThrow();
  });

  it('throws ForbiddenException when agent has lower perm than required', () => {
    expect(() =>
      requirePermission(
        { humanPermission: 'write', agentPermission: 'read' },
        { id: 'a', isAgent: true },
        'propose',
      ),
    ).toThrow(ForbiddenException);
  });

  it('includes the required and actual perms in the error message', () => {
    try {
      requirePermission(
        { humanPermission: 'read', agentPermission: 'read' },
        { id: 'u', isAgent: false },
        'write',
      );
      throw new Error('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toContain('write');
      expect((err as ForbiddenException).message).toContain('read');
    }
  });
});
