import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('@team9/shared', () => ({
  env: {
    OPENCLAW_AUTH_TOKEN: 'openclaw-secret',
  },
}));

const { OpenclawAuthGuard } = await import('./openclaw-auth.guard.js');

describe('OpenclawAuthGuard', () => {
  let guard: InstanceType<typeof OpenclawAuthGuard>;

  beforeEach(() => {
    guard = new OpenclawAuthGuard();
  });

  function createContext(authorization?: string | string[]) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: authorization === undefined ? {} : { authorization },
        }),
      }),
    };
  }

  it('allows requests with a matching bearer token', () => {
    expect(
      guard.canActivate(createContext('Bearer openclaw-secret') as never),
    ).toBe(true);
  });

  it('supports express authorization arrays and rejects mismatches', () => {
    expect(
      guard.canActivate(
        createContext(['Bearer openclaw-secret', 'Bearer ignored']) as never,
      ),
    ).toBe(true);
    expect(guard.canActivate(createContext('Bearer wrong') as never)).toBe(
      false,
    );
  });

  it('rejects missing or malformed authorization headers', () => {
    expect(guard.canActivate(createContext() as never)).toBe(false);
    expect(guard.canActivate(createContext('Basic abc') as never)).toBe(false);
    expect(
      guard.canActivate(createContext([123 as never] as never) as never),
    ).toBe(false);
  });
});
