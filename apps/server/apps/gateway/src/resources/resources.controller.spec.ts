import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ResourcesController } from './resources.controller.js';

function createResourcesServiceMock() {
  return {
    create: jest.fn<any>(),
    list: jest.fn<any>(),
    getById: jest.fn<any>(),
    update: jest.fn<any>(),
    delete: jest.fn<any>(),
    authorize: jest.fn<any>(),
    revoke: jest.fn<any>(),
    getUsageLogs: jest.fn<any>(),
    heartbeat: jest.fn<any>(),
  };
}

describe('ResourcesController', () => {
  let controller: ResourcesController;
  let resourcesService: ReturnType<typeof createResourcesServiceMock>;

  beforeEach(() => {
    resourcesService = createResourcesServiceMock();
    controller = new ResourcesController(resourcesService as never);
  });

  it('delegates create to the service with dto, userId, and tenantId', async () => {
    const dto = { type: 'mcp', name: 'Conn' };
    const resource = { id: 'resource-1' };
    resourcesService.create.mockResolvedValue(resource);

    await expect(
      controller.create(dto as never, 'user-1', 'tenant-1'),
    ).resolves.toEqual(resource);

    expect(resourcesService.create).toHaveBeenCalledWith(
      dto,
      'user-1',
      'tenant-1',
    );
  });

  it('delegates list with an optional type filter', async () => {
    const result = [{ id: 'resource-1' }];
    resourcesService.list.mockResolvedValue(result);

    await expect(controller.list('tenant-1', 'mcp' as never)).resolves.toEqual(
      result,
    );

    expect(resourcesService.list).toHaveBeenCalledWith('tenant-1', {
      type: 'mcp',
    });
  });

  it('delegates getById, update, and delete', async () => {
    resourcesService.getById.mockResolvedValue({ id: 'resource-1' });
    resourcesService.update.mockResolvedValue({
      id: 'resource-1',
      name: 'new',
    });
    resourcesService.delete.mockResolvedValue({ success: true });

    await controller.getById('resource-1', 'tenant-1');
    await controller.update(
      'resource-1',
      { name: 'new' } as never,
      'user-1',
      'tenant-1',
    );
    await controller.delete('resource-1', 'user-1', 'tenant-1');

    expect(resourcesService.getById).toHaveBeenCalledWith(
      'resource-1',
      'tenant-1',
    );
    expect(resourcesService.update).toHaveBeenCalledWith(
      'resource-1',
      { name: 'new' },
      'user-1',
      'tenant-1',
    );
    expect(resourcesService.delete).toHaveBeenCalledWith(
      'resource-1',
      'user-1',
      'tenant-1',
    );
  });

  it('delegates authorize and revoke', async () => {
    const dto = { granteeType: 'user', granteeId: 'user-2' };
    resourcesService.authorize.mockResolvedValue({ id: 'resource-1' });
    resourcesService.revoke.mockResolvedValue({ id: 'resource-1' });

    await controller.authorize(
      'resource-1',
      dto as never,
      'user-1',
      'tenant-1',
    );
    await controller.revoke('resource-1', dto as never, 'user-1', 'tenant-1');

    expect(resourcesService.authorize).toHaveBeenCalledWith(
      'resource-1',
      dto,
      'user-1',
      'tenant-1',
    );
    expect(resourcesService.revoke).toHaveBeenCalledWith(
      'resource-1',
      dto,
      'user-1',
      'tenant-1',
    );
  });

  it('delegates usage logs and heartbeat handlers', async () => {
    const logs = [{ id: 'log-1' }];
    resourcesService.getUsageLogs.mockResolvedValue(logs);
    resourcesService.heartbeat.mockResolvedValue({ id: 'resource-1' });

    await expect(
      controller.getUsageLogs('resource-1', 'tenant-1', 10, 20),
    ).resolves.toEqual(logs);
    await expect(controller.heartbeat('resource-1')).resolves.toEqual({
      id: 'resource-1',
    });

    expect(resourcesService.getUsageLogs).toHaveBeenCalledWith(
      'resource-1',
      'tenant-1',
      10,
      20,
    );
    expect(resourcesService.heartbeat).toHaveBeenCalledWith('resource-1');
  });
});
