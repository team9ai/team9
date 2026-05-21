import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@team9/shared', () => ({
  env: {
    JWT_PUBLIC_KEY: 'jwt-public-key',
  },
}));

const { AgentTempTokenValidatorService } =
  await import('./agent-temp-token-validator.service.js');

import type { JwtService } from '@nestjs/jwt';

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('AgentTempTokenValidatorService', () => {
  let jwtService: Pick<JwtService, 'verify'> & { verify: MockFn };
  let service: InstanceType<typeof AgentTempTokenValidatorService>;

  beforeEach(() => {
    jwtService = { verify: jest.fn<MockFn>() };
    service = new AgentTempTokenValidatorService(jwtService as never);
  });

  it('validates a Capability Hub scoped agent temp token', () => {
    jwtService.verify.mockReturnValue({
      sub: 'bot-user-1',
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      botId: 'bot-1',
      tokenUse: 'team9-agent-temp',
    });

    expect(service.validateCapabilityHubToken('jwt-temp')).toEqual({
      userId: 'bot-user-1',
      botId: 'bot-1',
      tenantId: 'tenant-1',
    });
    expect(jwtService.verify).toHaveBeenCalledWith('jwt-temp', {
      publicKey: 'jwt-public-key',
      algorithms: ['ES256'],
      audience: 'team9-capahub',
      issuer: 'team9',
    });
  });

  it('uses agentId as the billing bot id for older temp tokens without botId', () => {
    jwtService.verify.mockReturnValue({
      sub: 'bot-user-1',
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      tokenUse: 'team9-agent-temp',
    });

    expect(service.validateCapabilityHubToken('jwt-temp')).toEqual({
      userId: 'bot-user-1',
      botId: 'agent-1',
      tenantId: 'tenant-1',
    });
  });

  it('rejects tokens with the wrong tokenUse claim', () => {
    jwtService.verify.mockReturnValue({
      sub: 'bot-user-1',
      tenantId: 'tenant-1',
      botId: 'bot-1',
      tokenUse: 'team9-agent',
    });

    expect(service.validateCapabilityHubToken('jwt-temp')).toBeNull();
  });

  it('rejects tokens that fail JWT verification', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad token');
    });

    expect(service.validateCapabilityHubToken('jwt-temp')).toBeNull();
  });
});
