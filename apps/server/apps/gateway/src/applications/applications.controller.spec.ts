import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { ApplicationsController } from './applications.controller.js';

describe('ApplicationsController', () => {
  let applicationsService: {
    findAll: jest.Mock;
    findById: jest.Mock;
  };
  let controller: ApplicationsController;

  beforeEach(() => {
    applicationsService = {
      findAll: jest.fn(),
      findById: jest.fn(),
    };
    controller = new ApplicationsController(applicationsService as never);
  });

  it('returns all available applications', () => {
    applicationsService.findAll.mockReturnValue([{ id: 'app-1' }]);

    expect(controller.findAll()).toEqual([{ id: 'app-1' }]);
    expect(applicationsService.findAll).toHaveBeenCalled();
  });

  it('returns a specific application by id', () => {
    applicationsService.findById.mockReturnValue({ id: 'app-1' });

    expect(controller.findById('app-1')).toEqual({ id: 'app-1' });
    expect(applicationsService.findById).toHaveBeenCalledWith('app-1');
  });

  it('throws when the application does not exist', () => {
    applicationsService.findById.mockReturnValue(undefined);

    expect(() => controller.findById('missing-app')).toThrow(
      new NotFoundException('Application missing-app not found'),
    );
  });
});
