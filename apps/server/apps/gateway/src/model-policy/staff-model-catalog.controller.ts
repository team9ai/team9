import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@team9/auth';
import { appMetrics } from '@team9/observability';
import { ModelPolicyService } from './model-policy.service.js';
import { STAFF_MODEL_CATALOG_VERSION } from './staff-model-catalog.js';

function recordReadiness(runtimeReady: boolean, outcome: 'ready'): void {
  try {
    appMetrics.modelCatalogReadinessTotal.add(1, {
      catalog_version: STAFF_MODEL_CATALOG_VERSION,
      runtime_ready: String(runtimeReady),
      outcome,
    });
  } catch {
    // Catalog availability must not depend on telemetry availability.
  }
}

@Controller({ path: 'models', version: '1' })
@UseGuards(AuthGuard)
export class StaffModelCatalogController {
  constructor(private readonly modelPolicy: ModelPolicyService) {}

  @Get('staff')
  getCatalog(@Res({ passthrough: true }) response: Response) {
    response.setHeader('ETag', `"${STAFF_MODEL_CATALOG_VERSION}"`);

    const models = this.modelPolicy.getCatalog();
    recordReadiness(true, 'ready');
    return {
      catalogVersion: STAFF_MODEL_CATALOG_VERSION,
      runtimeReady: true,
      models,
    };
  }
}
