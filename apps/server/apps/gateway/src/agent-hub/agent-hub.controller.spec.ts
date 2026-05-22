import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import {
  BadRequestException,
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { AuthGuard } from '@team9/auth';
import { WorkspaceGuard } from '../workspace/guards/workspace.guard.js';
import { AgentHubController } from './agent-hub.controller.js';
import { AgentHubService } from './agent-hub.service.js';

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
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

describe('AgentHubController validation', () => {
  let app: INestApplication;
  let service: {
    listRecommendedStaff: MockFn;
    installRecommendedStaff: MockFn;
  };

  beforeEach(async () => {
    service = {
      listRecommendedStaff: jest.fn<any>().mockResolvedValue([]),
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
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => Request & { user?: unknown };
          };
        }) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { sub: 'user-1' };
          return true;
        },
      })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.use(
      (
        req: Request & { tenantId?: string },
        _res: Response,
        next: NextFunction,
      ) => {
        const tenantId = req.headers['x-tenant-id'];
        if (typeof tenantId === 'string') {
          req.tenantId = tenantId;
        }
        next();
      },
    );
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects invalid mentorId before delegating to the service', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/agent-hub/recommended-staff/sales-analyst/install')
      .set('x-tenant-id', 'tenant-1')
      .send({ mentorId: 'not-a-uuid' })
      .expect(400);

    expect(service.installRecommendedStaff).not.toHaveBeenCalled();
  });

  it('transforms blank mentorId to null before service delegation', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/agent-hub/recommended-staff/sales-analyst/install')
      .set('x-tenant-id', 'tenant-1')
      .send({ mentorId: '   ', extra: 'ignored' })
      .expect(201);

    expect(service.installRecommendedStaff).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'sales-analyst',
      expect.objectContaining({ mentorId: null }),
    );
    const dto = service.installRecommendedStaff.mock.calls[0]?.[3];
    expect(dto).not.toHaveProperty('extra');
  });
});
