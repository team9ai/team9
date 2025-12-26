import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlag } from '../edition.enum';
import { EditionService } from '../edition.service';
import { REQUIRED_FEATURES_KEY } from '../decorators/require-feature.decorator';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly editionService: EditionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredFeatures = this.reflector.getAllAndOverride<FeatureFlag[]>(
      REQUIRED_FEATURES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No feature requirements, allow access
    if (!requiredFeatures || requiredFeatures.length === 0) {
      return true;
    }

    // Check if all required features are enabled
    const hasAllFeatures = this.editionService.hasAllFeatures(requiredFeatures);

    if (!hasAllFeatures) {
      const missingFeatures = requiredFeatures.filter(
        (f) => !this.editionService.hasFeature(f),
      );

      throw new ForbiddenException({
        statusCode: 403,
        error: 'Feature Not Available',
        message: `This feature requires an Enterprise license. Missing features: ${missingFeatures.join(', ')}`,
        requiredFeatures,
        missingFeatures,
        currentEdition: this.editionService.getEdition(),
        upgradeUrl: 'https://your-product.com/pricing',
      });
    }

    return true;
  }
}
