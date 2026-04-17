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

    it('should include common-staff as a managed singleton app with autoInstall', () => {
      const commonStaff = service
        .findAll()
        .find((app) => app.id === 'common-staff');

      expect(commonStaff).toBeDefined();
      expect(commonStaff!.type).toBe('managed');
      expect(commonStaff!.singleton).toBe(true);
      expect(commonStaff!.autoInstall).toBe(true);
    });

    it('should include personal-staff as a managed singleton app with autoInstall', () => {
      const personalStaff = service
        .findAll()
        .find((app) => app.id === 'personal-staff');

      expect(personalStaff).toBeDefined();
      expect(personalStaff!.type).toBe('managed');
      expect(personalStaff!.singleton).toBe(true);
      expect(personalStaff!.autoInstall).toBe(true);
    });

    it('should mark openclaw as hidden', () => {
      const openclaw = service.findAll().find((app) => app.id === 'openclaw');
      expect(openclaw).toBeDefined();
      expect(openclaw!.hidden).toBe(true);
    });
  });

  describe('findAllVisible', () => {
    it('excludes hidden apps when the tenant has not installed them', () => {
      const apps = service.findAllVisible(new Set<string>());
      expect(apps.some((app) => app.id === 'openclaw')).toBe(false);
    });

    it('includes hidden apps when the tenant has installed them', () => {
      const apps = service.findAllVisible(new Set<string>(['openclaw']));
      expect(apps.some((app) => app.id === 'openclaw')).toBe(true);
    });

    it('always includes non-hidden apps regardless of install state', () => {
      const apps = service.findAllVisible(new Set<string>());
      expect(apps.some((app) => app.id === 'base-model-staff')).toBe(true);
      expect(apps.some((app) => app.id === 'common-staff')).toBe(true);
      expect(apps.some((app) => app.id === 'personal-staff')).toBe(true);
    });

    it('never returns disabled apps', () => {
      const apps = service.findAllVisible(new Set<string>(['openclaw']));
      expect(apps.every((app) => app.enabled)).toBe(true);
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

    it('still returns hidden apps (used by install/uninstall handlers)', () => {
      const app = service.findById('openclaw');
      expect(app).toBeDefined();
      expect(app!.hidden).toBe(true);
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

    it('should include common-staff', () => {
      const autoApps = service.findAutoInstall();

      expect(autoApps.some((app) => app.id === 'common-staff')).toBe(true);
    });

    it('should include personal-staff', () => {
      const autoApps = service.findAutoInstall();

      expect(autoApps.some((app) => app.id === 'personal-staff')).toBe(true);
    });

    it('should not include openclaw', () => {
      const autoApps = service.findAutoInstall();

      expect(autoApps.some((app) => app.id === 'openclaw')).toBe(false);
    });

    it('excludes any hidden app even if autoInstall were set', () => {
      const autoApps = service.findAutoInstall();
      expect(autoApps.every((app) => !app.hidden)).toBe(true);
    });
  });
});
