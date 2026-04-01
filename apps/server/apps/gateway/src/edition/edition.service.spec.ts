import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { EditionService } from './edition.service.js';
import { Edition, FeatureFlag } from './edition.enum.js';

describe('EditionService', () => {
  const originalEdition = process.env.EDITION;

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    if (originalEdition === undefined) {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }
  });

  it('defaults to the community edition and exposes its feature limits', () => {
    delete process.env.EDITION;
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const service = new EditionService();

    expect(service.getEdition()).toBe(Edition.COMMUNITY);
    expect(service.isCommunity()).toBe(true);
    expect(service.isEnterprise()).toBe(false);
    expect(service.getConfig()).toEqual(
      expect.objectContaining({
        edition: Edition.COMMUNITY,
        name: 'Community Edition',
        maxUsers: 100,
        maxChannels: 50,
        maxStorageMB: 5120,
      }),
    );
    expect(service.hasFeature(FeatureFlag.BASIC_AUTH)).toBe(true);
    expect(service.hasFeature(FeatureFlag.MULTI_TENANT)).toBe(false);
    expect(
      service.hasAllFeatures([
        FeatureFlag.BASIC_AUTH,
        FeatureFlag.CHANNELS,
        FeatureFlag.DIRECT_MESSAGES,
      ]),
    ).toBe(true);
    expect(
      service.hasAnyFeature([FeatureFlag.AUDIT_LOG, FeatureFlag.REACTIONS]),
    ).toBe(true);
    expect(service.getEnabledFeatures()).toContain(FeatureFlag.REACTIONS);
    expect(service.getMaxUsers()).toBe(100);
    expect(service.getMaxChannels()).toBe(50);
    expect(service.getMaxStorageMB()).toBe(5120);
    expect(logSpy).toHaveBeenCalledWith('Running Community Edition');
    expect(logSpy).toHaveBeenCalledWith('Max users: 100');
    expect(logSpy).toHaveBeenCalledWith('Max channels: 50');
    expect(logSpy).toHaveBeenCalledWith('Features enabled: 7');
  });

  it('loads enterprise limits and feature flags when configured', () => {
    process.env.EDITION = Edition.ENTERPRISE;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const service = new EditionService();

    expect(service.getEdition()).toBe(Edition.ENTERPRISE);
    expect(service.isEnterprise()).toBe(true);
    expect(service.isCommunity()).toBe(false);
    expect(service.hasFeature(FeatureFlag.MULTI_TENANT)).toBe(true);
    expect(
      service.hasAllFeatures([
        FeatureFlag.SSO_SAML,
        FeatureFlag.AUDIT_LOG,
        FeatureFlag.CUSTOM_BRANDING,
      ]),
    ).toBe(true);
    expect(
      service.hasAnyFeature([
        FeatureFlag.UNLIMITED_USERS,
        FeatureFlag.UNLIMITED_STORAGE,
      ]),
    ).toBe(true);
    expect(service.getMaxUsers()).toBe(Infinity);
    expect(service.getMaxChannels()).toBe(Infinity);
    expect(service.getMaxStorageMB()).toBe(Infinity);
  });
});
