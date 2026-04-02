import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { FeatureGuard } from './feature.guard.js';

describe('FeatureGuard', () => {
  let reflector: {
    getAllAndOverride: jest.Mock<any>;
  };
  let editionService: {
    hasAllFeatures: jest.Mock<any>;
    hasFeature: jest.Mock<any>;
    getEdition: jest.Mock<any>;
  };
  let guard: FeatureGuard;
  let context: {
    getHandler: jest.Mock<any>;
    getClass: jest.Mock<any>;
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn<any>(),
    };
    editionService = {
      hasAllFeatures: jest.fn<any>(),
      hasFeature: jest.fn<any>(),
      getEdition: jest.fn<any>().mockReturnValue('community'),
    };
    guard = new FeatureGuard(reflector as never, editionService as never);
    context = {
      getHandler: jest.fn<any>(),
      getClass: jest.fn<any>(),
    };
  });

  it('allows access when no features are required', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);

    expect(guard.canActivate(context as never)).toBe(true);
    expect(editionService.hasAllFeatures).not.toHaveBeenCalled();
  });

  it('allows access when every required feature is enabled', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(['audit_logs']);
    editionService.hasAllFeatures.mockReturnValueOnce(true);

    expect(guard.canActivate(context as never)).toBe(true);
    expect(editionService.hasAllFeatures).toHaveBeenCalledWith(['audit_logs']);
  });

  it('throws a detailed forbidden error when features are missing', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([
      'audit_logs',
      'sso',
      'scim',
    ]);
    editionService.hasAllFeatures.mockReturnValueOnce(false);
    editionService.hasFeature.mockImplementation(
      (feature: string) => feature === 'audit_logs',
    );

    expect(() => guard.canActivate(context as never)).toThrow(
      ForbiddenException,
    );
    expect(editionService.hasFeature).toHaveBeenCalledWith('audit_logs');
    expect(editionService.hasFeature).toHaveBeenCalledWith('sso');
    expect(editionService.hasFeature).toHaveBeenCalledWith('scim');

    try {
      guard.canActivate(context as never);
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        error: 'Feature Not Available',
        message:
          'This feature requires an Enterprise license. Missing features: sso, scim',
        requiredFeatures: ['audit_logs', 'sso', 'scim'],
        missingFeatures: ['sso', 'scim'],
        currentEdition: 'community',
        upgradeUrl: 'https://your-product.com/pricing',
      });
    }
  });
});
