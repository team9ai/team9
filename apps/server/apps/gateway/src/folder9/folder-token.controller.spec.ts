import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule(
  '../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenant: () => () => undefined,
    CurrentTenantId: () => () => undefined,
  }),
);

jest.unstable_mockModule('./folder-token.service.js', () => ({
  FolderTokenService: class FolderTokenService {},
}));

const { FolderTokenController } = await import('./folder-token.controller.js');
const { FolderTokenService } = await import('./folder-token.service.js');

import { Test, TestingModule } from '@nestjs/testing';
import type { FolderTokenResponse } from './folder-token.service.js';
import type { FolderTokenRequestDto } from './dto/folder-token-request.dto.js';

type MockFn = jest.Mock<(...args: any[]) => any>;

const BOT_USER_ID = 'bot-user-uuid-1234';
const TENANT_ID = 'tenant-uuid-1';

const makeDto = (
  overrides: Partial<FolderTokenRequestDto> = {},
): FolderTokenRequestDto =>
  ({
    sessionId: 'session-1',
    agentId: 'agent-1',
    routineId: 'routine-1',
    userId: 'user-1',
    logicalKey: 'routine.document',
    workspaceId: TENANT_ID,
    folderId: 'folder-1',
    folderType: 'managed',
    permission: 'write',
    ...overrides,
  }) as FolderTokenRequestDto;

describe('FolderTokenController', () => {
  let controller: InstanceType<typeof FolderTokenController>;
  let service: { issueToken: MockFn };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FolderTokenController],
      providers: [FolderTokenService],
    }).compile();

    controller = module.get(FolderTokenController);
    service = module.get(FolderTokenService);

    service.issueToken = jest.fn<MockFn>();
  });

  describe('POST /api/v1/bot/folder-token', () => {
    it('returns issued token from service when header matches sub', async () => {
      const response: FolderTokenResponse = {
        token: 'tok-issued',
        expiresAt: 1_700_000_000_000,
      };
      service.issueToken.mockResolvedValue(response);
      const dto = makeDto();

      const result = await controller.issue(
        dto,
        BOT_USER_ID,
        TENANT_ID,
        BOT_USER_ID,
      );

      expect(result).toEqual(response);
    });

    it('forwards dto + sub + tenantId to service', async () => {
      const response: FolderTokenResponse = { token: 'tok-fwd' };
      service.issueToken.mockResolvedValue(response);
      const dto = makeDto({ logicalKey: 'session.tmp' });

      await controller.issue(dto, BOT_USER_ID, TENANT_ID, BOT_USER_ID);

      expect(service.issueToken).toHaveBeenCalledWith(
        dto,
        BOT_USER_ID,
        TENANT_ID,
      );
      expect(service.issueToken).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException when X-Team9-Bot-User-Id header is missing', async () => {
      const dto = makeDto();
      await expect(
        controller.issue(dto, BOT_USER_ID, TENANT_ID, undefined),
      ).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
    });

    it('throws ForbiddenException when header is empty string', async () => {
      const dto = makeDto();
      await expect(
        controller.issue(dto, BOT_USER_ID, TENANT_ID, ''),
      ).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
    });

    it('throws ForbiddenException when header does not match authenticated sub', async () => {
      const dto = makeDto();
      await expect(
        controller.issue(dto, BOT_USER_ID, TENANT_ID, 'different-user-id'),
      ).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: 'X-Team9-Bot-User-Id does not match authenticated bot',
      });
    });

    it('passes the authenticated user id (not the header) to the service', async () => {
      const response: FolderTokenResponse = { token: 'tok' };
      service.issueToken.mockResolvedValue(response);
      const dto = makeDto();

      await controller.issue(dto, BOT_USER_ID, TENANT_ID, BOT_USER_ID);

      // Service receives sub, not header (controller asserted equality
      // already so they're equal here, but the contract is "sub").
      const callArgs = service.issueToken.mock.calls[0];
      expect(callArgs[1]).toBe(BOT_USER_ID);
    });

    it('forwards undefined tenantId to the service when middleware did not set one', async () => {
      const response: FolderTokenResponse = { token: 'tok' };
      service.issueToken.mockResolvedValue(response);
      const dto = makeDto();

      await controller.issue(dto, BOT_USER_ID, undefined, BOT_USER_ID);

      expect(service.issueToken).toHaveBeenCalledWith(
        dto,
        BOT_USER_ID,
        undefined,
      );
    });

    it('does not call the service when header validation fails', async () => {
      const dto = makeDto();

      await expect(
        controller.issue(dto, BOT_USER_ID, TENANT_ID, 'mismatch'),
      ).rejects.toThrow();

      expect(service.issueToken).not.toHaveBeenCalled();
    });
  });
});
