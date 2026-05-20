import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule(
  '../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenantId: () => () => undefined,
  }),
);

jest.unstable_mockModule('./agent-temp-token.service.js', () => ({
  AgentTempTokenService: class AgentTempTokenService {},
}));

const { AgentTempTokenController } =
  await import('./agent-temp-token.controller.js');
const { AgentTempTokenService } = await import('./agent-temp-token.service.js');

import { Test, TestingModule } from '@nestjs/testing';
import type {
  AgentTempTokenRequestDto,
  AgentTempTokenResponse,
} from './dto/agent-temp-token-request.dto.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

const BOT_USER_ID = 'bot-user-uuid-1234';
const TENANT_ID = 'tenant-uuid-1';

const makeDto = (
  overrides: Partial<AgentTempTokenRequestDto> = {},
): AgentTempTokenRequestDto =>
  ({
    sessionId: 'team9/tenant-1/agent-1/dm/channel-1',
    agentId: 'agent-1',
    ttlSeconds: 3600,
    audiences: ['team9-agent', 'team9-ahand', 'team9-capahub'],
    ...overrides,
  }) as AgentTempTokenRequestDto;

describe('AgentTempTokenController', () => {
  let controller: InstanceType<typeof AgentTempTokenController>;
  let service: { issueToken: MockFn };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentTempTokenController],
      providers: [AgentTempTokenService],
    }).compile();

    controller = module.get(AgentTempTokenController);
    service = module.get(AgentTempTokenService);

    service.issueToken = jest.fn<MockFn>();
  });

  describe('POST /api/v1/bot/agent-temp-token', () => {
    it('returns issued temp token from service when header matches sub', async () => {
      const response: AgentTempTokenResponse = {
        token: 'jwt-issued',
        tokenId: 'tok-1',
        expiresAt: '2026-05-20T13:00:00.000Z',
      };
      service.issueToken.mockResolvedValue(response);

      const result = await controller.issue(
        makeDto(),
        BOT_USER_ID,
        TENANT_ID,
        BOT_USER_ID,
      );

      expect(result).toEqual(response);
    });

    it('forwards dto, authenticated sub, and tenant id to service', async () => {
      service.issueToken.mockResolvedValue({
        token: 'jwt-issued',
        tokenId: 'tok-1',
        expiresAt: '2026-05-20T13:00:00.000Z',
      });
      const dto = makeDto({ agentId: 'agent-forwarded' });

      await controller.issue(dto, BOT_USER_ID, TENANT_ID, BOT_USER_ID);

      expect(service.issueToken).toHaveBeenCalledWith(
        dto,
        BOT_USER_ID,
        TENANT_ID,
      );
      expect(service.issueToken).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException when X-Team9-Bot-User-Id header is missing', async () => {
      await expect(
        controller.issue(makeDto(), BOT_USER_ID, TENANT_ID, undefined),
      ).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
      expect(service.issueToken).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when X-Team9-Bot-User-Id header is empty', async () => {
      await expect(
        controller.issue(makeDto(), BOT_USER_ID, TENANT_ID, ''),
      ).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
      expect(service.issueToken).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when header does not match authenticated sub', async () => {
      await expect(
        controller.issue(
          makeDto(),
          BOT_USER_ID,
          TENANT_ID,
          'different-user-id',
        ),
      ).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
      expect(service.issueToken).not.toHaveBeenCalled();
    });
  });
});
