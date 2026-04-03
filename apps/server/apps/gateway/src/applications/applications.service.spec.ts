import { describe, it, expect } from '@jest/globals';
import { ApplicationsService } from './applications.service.js';

describe('ApplicationsService', () => {
  let service: ApplicationsService;

  beforeEach(() => {
    service = new ApplicationsService();
  });

  describe('findAll', () => {
    it('should return all enabled applications', () => {
      const apps = service.findAll();

      expect(apps.length).toBeGreaterThan(0);
      expect(apps.every((app) => app.enabled)).toBe(true);
    });

    it('should include openclaw as a custom app', () => {
      const openclaw = service.findAll().find((app) => app.id === 'openclaw');

      expect(openclaw).toBeDefined();
      expect(openclaw!.type).toBe('custom');
    });

    it('should include base-model-staff as a custom app with autoInstall', () => {
      const baseModel = service
        .findAll()
        .find((app) => app.id === 'base-model-staff');

      expect(baseModel).toBeDefined();
      expect(baseModel!.type).toBe('custom');
      expect(baseModel!.autoInstall).toBe(true);
    });
  });

  describe('findById', () => {
    it('should return an application by id', () => {
      const app = service.findById('openclaw');

      expect(app).toBeDefined();
      expect(app!.id).toBe('openclaw');
    });

    it('should return undefined for unknown id', () => {
      expect(service.findById('nonexistent')).toBeUndefined();
    });
  });

  describe('findAutoInstall', () => {
    it('should return only apps with autoInstall: true', () => {
      const autoApps = service.findAutoInstall();

      expect(autoApps.length).toBeGreaterThan(0);
      expect(autoApps.every((app) => app.autoInstall === true)).toBe(true);
    });

    it('should include base-model-staff', () => {
      const autoApps = service.findAutoInstall();

      expect(autoApps.some((app) => app.id === 'base-model-staff')).toBe(true);
    });

    it('should not include openclaw', () => {
      const autoApps = service.findAutoInstall();

      expect(autoApps.some((app) => app.id === 'openclaw')).toBe(false);
    });
  });
});
