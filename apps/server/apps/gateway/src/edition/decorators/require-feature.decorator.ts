import { SetMetadata } from '@nestjs/common';
import { FeatureFlag } from '../edition.enum.js';

export const REQUIRED_FEATURES_KEY = 'required_features';

/**
 * Decorator to mark a controller or handler as requiring specific features.
 * If the current edition doesn't have the required features, the request will be rejected.
 *
 * @example
 * ```typescript
 * @Controller('tenants')
 * @RequireFeature(FeatureFlag.MULTI_TENANT)
 * export class TenantController {
 *   // All routes in this controller require MULTI_TENANT feature
 * }
 *
 * @Controller('analytics')
 * export class AnalyticsController {
 *   @Get('advanced')
 *   @RequireFeature(FeatureFlag.ADVANCED_ANALYTICS)
 *   getAdvancedAnalytics() {
 *     // Only this route requires ADVANCED_ANALYTICS feature
 *   }
 * }
 * ```
 */
export const RequireFeature = (...features: FeatureFlag[]) =>
  SetMetadata(REQUIRED_FEATURES_KEY, features);
