import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('@team9/auth', () => ({
  AuthGuard: class AuthGuard {},
  CurrentUser: () => () => undefined,
}));

jest.unstable_mockModule(
  '../../common/decorators/current-tenant.decorator.js',
  () => ({
    CurrentTenantId: () => () => undefined,
  }),
);

jest.unstable_mockModule('../../workspace/guards/index.js', () => ({
  WorkspaceGuard: class WorkspaceGuard {},
  WorkspaceRoleGuard: class WorkspaceRoleGuard {},
  WorkspaceRoles: () => () => undefined,
}));

jest.unstable_mockModule('./sections.service.js', () => ({
  SectionsService: class SectionsService {},
}));

const { SectionsController, ChannelSectionController } =
  await import('./sections.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

describe('SectionsController', () => {
  let controller: any;
  let sectionsService: {
    getSections: MockFn;
    getSectionsWithChannels: MockFn;
    create: MockFn;
    findByIdOrThrow: MockFn;
    update: MockFn;
    delete: MockFn;
    reorderSections: MockFn;
    moveChannelToSection: MockFn;
  };

  beforeEach(() => {
    sectionsService = {
      getSections: jest.fn<any>().mockResolvedValue([{ id: 'section-1' }]),
      getSectionsWithChannels: jest
        .fn<any>()
        .mockResolvedValue([{ id: 'section-1', channels: [] }]),
      create: jest.fn<any>().mockResolvedValue({ id: 'section-created' }),
      findByIdOrThrow: jest
        .fn<any>()
        .mockResolvedValue({ id: 'section-1', name: 'General' }),
      update: jest
        .fn<any>()
        .mockResolvedValue({ id: 'section-1', name: 'Renamed' }),
      delete: jest.fn<any>().mockResolvedValue(undefined),
      reorderSections: jest.fn<any>().mockResolvedValue([{ id: 'section-2' }]),
      moveChannelToSection: jest.fn<any>().mockResolvedValue(undefined),
    };

    controller = new SectionsController(sectionsService as any);
  });

  it('forwards tenantId to getSections()', async () => {
    const result = await controller.getSections('tenant-1');

    expect(sectionsService.getSections).toHaveBeenCalledWith('tenant-1');
    expect(result).toEqual([{ id: 'section-1' }]);
  });

  it('forwards tenantId to getSectionsWithChannels()', async () => {
    const result = await controller.getSectionsWithChannels('tenant-1');

    expect(sectionsService.getSectionsWithChannels).toHaveBeenCalledWith(
      'tenant-1',
    );
    expect(result).toEqual([{ id: 'section-1', channels: [] }]);
  });

  it('forwards create payload, user, and tenant to createSection()', async () => {
    const dto = { name: 'Announcements' } as any;

    const result = await controller.createSection('user-1', 'tenant-1', dto);

    expect(sectionsService.create).toHaveBeenCalledWith(
      dto,
      'user-1',
      'tenant-1',
    );
    expect(result).toEqual({ id: 'section-created' });
  });

  it('forwards sectionId to getSection()', async () => {
    const result = await controller.getSection('section-1');

    expect(sectionsService.findByIdOrThrow).toHaveBeenCalledWith('section-1');
    expect(result).toEqual({ id: 'section-1', name: 'General' });
  });

  it('forwards update payload and user to updateSection()', async () => {
    const dto = { name: 'Renamed' } as any;

    const result = await controller.updateSection('user-1', 'section-1', dto);

    expect(sectionsService.update).toHaveBeenCalledWith(
      'section-1',
      dto,
      'user-1',
    );
    expect(result).toEqual({ id: 'section-1', name: 'Renamed' });
  });

  it('forwards sectionId and user to deleteSection() and returns success', async () => {
    const result = await controller.deleteSection('user-1', 'section-1');

    expect(sectionsService.delete).toHaveBeenCalledWith('section-1', 'user-1');
    expect(result).toEqual({ success: true });
  });

  it('forwards section order and tenant to reorderSections()', async () => {
    const dto = { sectionIds: ['section-2', 'section-1'] } as any;

    const result = await controller.reorderSections('tenant-1', dto);

    expect(sectionsService.reorderSections).toHaveBeenCalledWith(
      ['section-2', 'section-1'],
      'tenant-1',
    );
    expect(result).toEqual([{ id: 'section-2' }]);
  });
});

describe('ChannelSectionController', () => {
  let controller: any;
  let sectionsService: {
    moveChannelToSection: MockFn;
  };

  beforeEach(() => {
    sectionsService = {
      moveChannelToSection: jest.fn<any>().mockResolvedValue(undefined),
    };

    controller = new ChannelSectionController(sectionsService as any);
  });

  it('forwards channelId, sectionId, order, and user to moveChannel()', async () => {
    const result = await controller.moveChannel('user-1', 'channel-1', {
      sectionId: 'section-2',
      order: 3,
    } as any);

    expect(sectionsService.moveChannelToSection).toHaveBeenCalledWith(
      'channel-1',
      'section-2',
      3,
      'user-1',
    );
    expect(result).toEqual({ success: true });
  });

  it('normalizes missing sectionId to null when moving a channel', async () => {
    await controller.moveChannel('user-1', 'channel-1', { order: 0 } as any);

    expect(sectionsService.moveChannelToSection).toHaveBeenCalledWith(
      'channel-1',
      null,
      0,
      'user-1',
    );
  });
});
