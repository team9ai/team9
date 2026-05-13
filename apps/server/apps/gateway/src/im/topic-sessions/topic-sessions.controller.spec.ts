import { describe, expect, it, jest } from '@jest/globals';
import { TopicSessionsController } from './topic-sessions.controller.js';

describe('TopicSessionsController', () => {
  it('passes larger grouped per-agent limits through for sidebar load more', async () => {
    const service = {
      listGrouped: jest.fn<any>().mockResolvedValue([]),
    };
    const controller = new TopicSessionsController(service as any);

    await controller.grouped('user-1', 'tenant-1', '50');

    expect(service.listGrouped).toHaveBeenCalledWith('user-1', 'tenant-1', 50);
  });

  it('passes permanent delete requests to the service', async () => {
    const service = {
      delete: jest.fn<any>().mockResolvedValue(undefined),
    };
    const controller = new TopicSessionsController(service as any);

    await controller.delete(
      'user-1',
      'tenant-1',
      '00000000-0000-0000-0000-000000000001',
      'true',
    );

    expect(service.delete).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
      channelId: '00000000-0000-0000-0000-000000000001',
      permanent: true,
    });
  });
});
