const { matchesScope, isScopeNarrowing } =
  await import('../permission-matcher.js');

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

describe('isScopeNarrowing', () => {
  it('rejects override that is missing a key the original constrained (broader)', () => {
    // original constrains toolNames; override omits it → broadens
    expect(
      isScopeNarrowing(
        { env: 'staging' },
        { toolNames: ['sql'], env: 'staging' },
      ),
    ).toBe(false);
  });

  it('rejects override whose array contains a value outside the original array (broader)', () => {
    // original: ['sql']; override adds 'shell' → broadens
    expect(
      isScopeNarrowing({ toolNames: ['sql', 'shell'] }, { toolNames: ['sql'] }),
    ).toBe(false);
  });

  it('accepts override that is equal to the original (not a broadening)', () => {
    expect(
      isScopeNarrowing(
        { toolNames: ['sql'], env: 'staging' },
        { toolNames: ['sql'], env: 'staging' },
      ),
    ).toBe(true);
  });

  it('accepts override whose array is a strict subset of the original array (narrowing)', () => {
    // original: ['sql', 'shell']; override: ['sql'] → narrower
    expect(
      isScopeNarrowing({ toolNames: ['sql'] }, { toolNames: ['sql', 'shell'] }),
    ).toBe(true);
  });

  it('accepts override with a single string value that is in the original array (narrowing)', () => {
    // original array contains 'sql'; override is a single string 'sql' → narrowing
    expect(
      isScopeNarrowing({ toolName: 'sql' }, { toolNames: ['sql', 'shell'] }),
    ).toBe(false); // key mismatch (toolName vs toolNames) → treated as missing key
  });

  it('accepts override with extra keys beyond the original (additional constraints = narrowing)', () => {
    // override adds 'region' which original did not constrain → still narrowing
    expect(
      isScopeNarrowing(
        { toolNames: ['sql'], region: 'us-east-1' },
        { toolNames: ['sql'] },
      ),
    ).toBe(true);
  });

  it('rejects when override string value differs from original string (broader for that key)', () => {
    expect(isScopeNarrowing({ env: 'prod' }, { env: 'staging' })).toBe(false);
  });
});
