import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';

const dbModule = {
  DATABASE_CONNECTION: Symbol('DATABASE_CONNECTION'),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
};

const schemaModule = {
  bots: {
    id: 'bots.id',
    userId: 'bots.user_id',
    isActive: 'bots.is_active',
    managedMeta: 'bots.managed_meta',
  },
};

jest.unstable_mockModule('@team9/database', () => dbModule);
jest.unstable_mockModule('@team9/database/schemas', () => schemaModule);
jest.unstable_mockModule('@team9/shared', () => ({
  env: {
    JWT_PRIVATE_KEY: 'jwt-private-key',
  },
}));

const { AgentTempTokenService } = await import('./agent-temp-token.service.js');

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { AgentTempTokenRequestDto } from './dto/agent-temp-token-request.dto.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

function createQuery(resolve: () => unknown) {
  const query: Record<string, MockFn> & {
    then: (
      onfulfilled: (value: unknown) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    from: jest.fn<any>(),
    where: jest.fn<any>(),
    limit: jest.fn<any>(),
    then(onfulfilled, onrejected) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };
  for (const key of ['from', 'where', 'limit'] as const) {
    query[key].mockReturnValue(query as never);
  }
  return query;
}

function mockDb() {
  const state = {
    selectResults: [] as unknown[][],
  };
  const db = {
    __state: state,
    select: jest.fn(() => {
      const q = createQuery(() =>
        state.selectResults.length > 0 ? state.selectResults.shift() : [],
      );
      return q as never;
    }),
  };
  return db;
}

const BOT_ID = 'bot-1';
const BOT_USER_ID = 'bot-user-1';
const TENANT_ID = 'tenant-1';
const AGENT_ID = 'agent-1';
const NOW = new Date('2026-05-20T12:00:00.000Z');

const makeDto = (
  overrides: Partial<AgentTempTokenRequestDto> = {},
): AgentTempTokenRequestDto =>
  ({
    sessionId: 'team9/tenant-1/agent-1/dm/channel-1',
    agentId: AGENT_ID,
    ttlSeconds: 3600,
    audiences: ['team9-agent', 'team9-ahand', 'team9-capahub'],
    ...overrides,
  }) as AgentTempTokenRequestDto;

describe('AgentTempTokenService', () => {
  let service: InstanceType<typeof AgentTempTokenService>;
  let db: ReturnType<typeof mockDb>;
  let jwtService: Pick<JwtService, 'sign'> & { sign: MockFn };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    db = mockDb();
    jwtService = { sign: jest.fn<MockFn>().mockReturnValue('jwt-issued') };
    service = new AgentTempTokenService(db as never, jwtService as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('mints a one-hour ES256 JWT for the authenticated bot agent', async () => {
    db.__state.selectResults.push([
      { id: BOT_ID, userId: BOT_USER_ID, managedMeta: { agentId: AGENT_ID } },
    ]);

    const result = await service.issueToken(makeDto(), BOT_USER_ID, TENANT_ID);

    expect(result).toEqual({
      token: 'jwt-issued',
      tokenId: expect.any(String),
      expiresAt: '2026-05-20T13:00:00.000Z',
    });
    const [payload, options] = jwtService.sign.mock.calls[0];
    expect(payload).toEqual({
      sub: BOT_USER_ID,
      userId: BOT_USER_ID,
      botUserId: BOT_USER_ID,
      botId: BOT_ID,
      tenantId: TENANT_ID,
      sessionId: 'team9/tenant-1/agent-1/dm/channel-1',
      agentId: AGENT_ID,
      tokenUse: 'team9-agent-temp',
      jti: result.tokenId,
      capabilityHubAccess: 'inherit',
    });
    expect(options).toEqual({
      privateKey: 'jwt-private-key',
      algorithm: 'ES256',
      expiresIn: 3600,
      audience: ['team9-agent', 'team9-ahand', 'team9-capahub'],
      issuer: 'team9',
    });
  });

  it('uses managedMeta.agentId when request omits agentId', async () => {
    db.__state.selectResults.push([
      { id: BOT_ID, userId: BOT_USER_ID, managedMeta: { agentId: AGENT_ID } },
    ]);

    await service.issueToken(
      makeDto({ agentId: undefined }),
      BOT_USER_ID,
      TENANT_ID,
    );

    const [payload] = jwtService.sign.mock.calls[0];
    expect(payload).toMatchObject({ agentId: AGENT_ID });
  });

  it('rejects requests when tenant context is missing', async () => {
    await expect(
      service.issueToken(makeDto(), BOT_USER_ID, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('rejects requests when caller is not an active bot', async () => {
    db.__state.selectResults.push([]);

    await expect(
      service.issueToken(makeDto(), BOT_USER_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('rejects requests when bot has no managed agent id', async () => {
    db.__state.selectResults.push([
      { id: BOT_ID, userId: BOT_USER_ID, managedMeta: null },
    ]);

    await expect(
      service.issueToken(makeDto(), BOT_USER_ID, TENANT_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('rejects requests for an agent not owned by the caller bot', async () => {
    db.__state.selectResults.push([
      { id: BOT_ID, userId: BOT_USER_ID, managedMeta: { agentId: AGENT_ID } },
    ]);

    await expect(
      service.issueToken(
        makeDto({ agentId: 'other-agent' }),
        BOT_USER_ID,
        TENANT_ID,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('rejects ttlSeconds values other than 3600', async () => {
    await expect(
      service.issueToken(
        makeDto({ ttlSeconds: 1800 as AgentTempTokenRequestDto['ttlSeconds'] }),
        BOT_USER_ID,
        TENANT_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('rejects unsupported audiences', async () => {
    await expect(
      service.issueToken(
        makeDto({
          audiences: [
            'team9-agent',
            'unknown',
          ] as AgentTempTokenRequestDto['audiences'],
        }),
        BOT_USER_ID,
        TENANT_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(jwtService.sign).not.toHaveBeenCalled();
  });
});
