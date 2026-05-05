import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';

// Mock ForwardsService before dynamic import of controller
jest.unstable_mockModule('./forwards.service.js', () => ({
  ForwardsService: class ForwardsService {},
}));

// Mock @team9/auth so AuthGuard can be resolved + overridden
jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => {},
}));

const { ForwardsController } = await import('./forwards.controller.js');
const { ForwardsService } = await import('./forwards.service.js');
const { AuthGuard } = await import('@team9/auth');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('ForwardsController', () => {
  let controller: InstanceType<typeof ForwardsController>;
  let svc: { forward: MockFn; getForwardItems: MockFn };

  beforeEach(async () => {
    svc = {
      forward: jest.fn(),
      getForwardItems: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ForwardsController],
      providers: [
        {
          provide: ForwardsService,
          useValue: svc,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ForwardsController);
  });

  describe('POST forward', () => {
    it('delegates to ForwardsService.forward with the right args', async () => {
      svc.forward.mockResolvedValueOnce({ id: 'm1', type: 'forward' } as never);
      const res = await controller.forward('u-1', 'ch-target', {
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['m-a', 'm-b'],
        clientMsgId: 'cid',
      });
      expect(svc.forward).toHaveBeenCalledWith({
        targetChannelId: 'ch-target',
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['m-a', 'm-b'],
        clientMsgId: 'cid',
        userId: 'u-1',
      });
      expect((res as { id: string }).id).toBe('m1');
    });

    it('passes undefined clientMsgId when not provided', async () => {
      svc.forward.mockResolvedValueOnce({ id: 'm2' } as never);
      await controller.forward('u-1', 'ch-target', {
        sourceChannelId: 'ch-src',
        sourceMessageIds: ['m-a'],
      });
      expect(svc.forward).toHaveBeenCalledWith(
        expect.objectContaining({ clientMsgId: undefined }),
      );
    });
  });

  describe('GET forward-items', () => {
    it('delegates to ForwardsService.getForwardItems', async () => {
      const items = [{ position: 0 }] as never;
      svc.getForwardItems.mockResolvedValueOnce(items);
      const res = await controller.getItems('u-1', 'msg-1');
      expect(svc.getForwardItems).toHaveBeenCalledWith('msg-1', 'u-1');
      expect(res).toBe(items);
    });
  });
});
