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
});
