import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

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

jest.unstable_mockModule('../workspace/guards/workspace.guard.js', () => ({
  WorkspaceGuard: class WorkspaceGuard {},
}));

jest.unstable_mockModule('./agent-hub.service.js', () => ({
  AgentHubService: class AgentHubService {},
}));

const { AgentHubController } = await import('./agent-hub.controller.js');
const { AgentHubService } = await import('./agent-hub.service.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('AgentHubController', () => {
  let controller: InstanceType<typeof AgentHubController>;
  let service: {
    listRecommendedStaff: MockFn;
    installRecommendedStaff: MockFn;
  };

  beforeEach(async () => {
    service = {
      listRecommendedStaff: jest.fn<any>().mockResolvedValue([
        {
          templateId: 'sales-analyst',
          displayName: 'Sales Analyst',
          installed: false,
        },
      ]),
      installRecommendedStaff: jest.fn<any>().mockResolvedValue({
        botId: 'bot-1',
        userId: 'bot-user-1',
        agentId: 'common-staff-bot-1',
        displayName: 'Sales Analyst',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentHubController],
      providers: [{ provide: AgentHubService, useValue: service }],
    }).compile();

    controller = module.get(AgentHubController);
  });

  it('lists recommended staff for the current tenant', async () => {
    const result = await controller.listRecommendedStaff('tenant-1');

    expect(result).toEqual([
      expect.objectContaining({ templateId: 'sales-analyst' }),
    ]);
    expect(service.listRecommendedStaff).toHaveBeenCalledWith('tenant-1');
  });

  it('installs a recommended staff template for the current tenant and user', async () => {
    const dto = { mentorId: 'mentor-1' };

    const result = await controller.installRecommendedStaff(
      'sales-analyst',
      'tenant-1',
      'user-1',
      dto,
    );

    expect(result).toEqual(
      expect.objectContaining({ agentId: 'common-staff-bot-1' }),
    );
    expect(service.installRecommendedStaff).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'sales-analyst',
      dto,
    );
  });

  it('passes an empty dto when install body is omitted', async () => {
    await controller.installRecommendedStaff(
      'sales-analyst',
      'tenant-1',
      'user-1',
      undefined,
    );

    expect(service.installRecommendedStaff).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'sales-analyst',
      {},
    );
  });

  it('throws BadRequest when tenant id is missing and does not call the service', async () => {
    await expect(
      controller.installRecommendedStaff(
        'sales-analyst',
        undefined,
        'user-1',
        {},
      ),
    ).rejects.toThrow(BadRequestException);

    expect(service.installRecommendedStaff).not.toHaveBeenCalled();
  });
});
