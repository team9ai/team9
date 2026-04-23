import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApplicationsController } from './applications.controller.js';

describe('ApplicationsController', () => {
  let applicationsService: {
    findAll: jest.Mock;
    findAllVisible: jest.Mock;
    findById: jest.Mock;
  };
  let installedApplicationsService: {
    findAllByTenant: jest.Mock;
    findByApplicationId: jest.Mock;
  };
  let controller: ApplicationsController;

  const TENANT_ID = 'tenant-uuid';

  beforeEach(() => {
    applicationsService = {
      findAll: jest.fn(),
      findAllVisible: jest.fn(),
      findById: jest.fn(),
    };
    installedApplicationsService = {
      findAllByTenant: jest.fn(),
      findByApplicationId: jest.fn(),
    };
    controller = new ApplicationsController(
      applicationsService as never,
      installedApplicationsService as never,
    );
  });

  describe('findAll', () => {
    it('passes the installed application ids to findAllVisible', async () => {
      installedApplicationsService.findAllByTenant.mockResolvedValue([
        { applicationId: 'common-staff' },
        { applicationId: 'openclaw' },
      ]);
      applicationsService.findAllVisible.mockReturnValue([
        { id: 'common-staff' },
      ]);

      const result = await controller.findAll(TENANT_ID);

      expect(installedApplicationsService.findAllByTenant).toHaveBeenCalledWith(
        TENANT_ID,
      );
      const arg = applicationsService.findAllVisible.mock
        .calls[0][0] as Set<string>;
      expect(arg.has('common-staff')).toBe(true);
      expect(arg.has('openclaw')).toBe(true);
      expect(result).toEqual([{ id: 'common-staff' }]);
    });

    it('throws BadRequestException when tenant id is missing', async () => {
      await expect(controller.findAll('')).rejects.toThrow(
        new BadRequestException('Tenant ID is required'),
      );
    });
  });

  describe('findById', () => {
    it('returns the app when it is not hidden', async () => {
      applicationsService.findById.mockReturnValue({
        id: 'common-staff',
        hidden: false,
      });

      const result = await controller.findById('common-staff', TENANT_ID);

      expect(result).toEqual({ id: 'common-staff', hidden: false });
      expect(
        installedApplicationsService.findByApplicationId,
      ).not.toHaveBeenCalled();
    });

    it('returns a hidden app when the tenant has installed it', async () => {
      applicationsService.findById.mockReturnValue({
        id: 'openclaw',
        hidden: true,
      });
      installedApplicationsService.findByApplicationId.mockResolvedValue({
        id: 'installed-uuid',
      });

      const result = await controller.findById('openclaw', TENANT_ID);

      expect(result).toEqual({ id: 'openclaw', hidden: true });
      expect(
        installedApplicationsService.findByApplicationId,
      ).toHaveBeenCalledWith(TENANT_ID, 'openclaw');
    });

    it('throws NotFoundException for a hidden app the tenant has not installed', async () => {
      applicationsService.findById.mockReturnValue({
        id: 'openclaw',
        hidden: true,
      });
      installedApplicationsService.findByApplicationId.mockResolvedValue(null);

      await expect(controller.findById('openclaw', TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for an unknown id', async () => {
      applicationsService.findById.mockReturnValue(undefined);

      await expect(
        controller.findById('missing-app', TENANT_ID),
      ).rejects.toThrow(
        new NotFoundException('Application missing-app not found'),
      );
    });

    it('throws BadRequestException when tenant id is missing', async () => {
      await expect(controller.findById('openclaw', '')).rejects.toThrow(
        new BadRequestException('Tenant ID is required'),
      );
    });
  });
});
