const { matchesScope } = await import('../permission-matcher.js');

describe('matchesScope', () => {
  it('returns true when scope is empty', () => {
    expect(matchesScope({ channelId: 'c1' }, {})).toBe(true);
    expect(matchesScope({}, {})).toBe(true);
  });

  it('matches an array whitelist', () => {
    const scope = { channelIds: ['c1', 'c2'] };
    expect(matchesScope({ channelId: 'c1' }, scope)).toBe(true);
    expect(matchesScope({ channelId: 'c3' }, scope)).toBe(false);
  });

  it('uses singular requested key against plural scope key', () => {
    // Convention: scope key `channelIds` matches request key `channelId`.
    expect(matchesScope({ channelId: 'c1' }, { channelIds: ['c1'] })).toBe(
      true,
    );
    expect(matchesScope({ toolName: 'sql' }, { toolNames: ['sql'] })).toBe(
      true,
    );
  });

  it('matches an exact string', () => {
    expect(matchesScope({ env: 'staging' }, { env: 'staging' })).toBe(true);
    expect(matchesScope({ env: 'prod' }, { env: 'staging' })).toBe(false);
  });

  it('matches a glob pattern', () => {
    expect(
      matchesScope({ path: '/data/foo.txt' }, { path: 'glob:/data/*' }),
    ).toBe(true);
    expect(
      matchesScope({ path: '/etc/passwd' }, { path: 'glob:/data/*' }),
    ).toBe(false);
  });

  it('returns false when request lacks a constrained field', () => {
    expect(matchesScope({}, { channelIds: ['c1'] })).toBe(false);
    expect(matchesScope({}, { env: 'prod' })).toBe(false);
  });

  it('all scope fields must match (AND semantics)', () => {
    const scope = { channelIds: ['c1'], env: 'staging' };
    expect(matchesScope({ channelId: 'c1', env: 'staging' }, scope)).toBe(true);
    expect(matchesScope({ channelId: 'c1', env: 'prod' }, scope)).toBe(false);
    expect(matchesScope({ channelId: 'c2', env: 'staging' }, scope)).toBe(
      false,
    );
  });
});
