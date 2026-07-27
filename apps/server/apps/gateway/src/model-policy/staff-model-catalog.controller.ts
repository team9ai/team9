import { Controller, Get, Logger, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@team9/auth';
import { ClawHiveService } from '@team9/claw-hive';
import { ModelPolicyService } from './model-policy.service.js';
import { STAFF_MODEL_CATALOG_VERSION } from './staff-model-catalog.js';

@Controller({ path: 'models', version: '1' })
@UseGuards(AuthGuard)
export class StaffModelCatalogController {
  private readonly logger = new Logger(StaffModelCatalogController.name);

  constructor(
    private readonly modelPolicy: ModelPolicyService,
    private readonly clawHive: ClawHiveService,
  ) {}

  @Get('staff')
  async getCatalog(@Res({ passthrough: true }) response: Response) {
    response.setHeader('ETag', `"${STAFF_MODEL_CATALOG_VERSION}"`);

    try {
      const readiness = await this.clawHive.getWorkerFleetReadiness();
      const models = this.modelPolicy.getRuntimeCatalog(readiness);
      return {
        catalogVersion: STAFF_MODEL_CATALOG_VERSION,
        runtimeReady: models.length > 0,
        models,
      };
    } catch {
      this.logger.warn('Agent runtime readiness is unavailable');
      return {
        catalogVersion: STAFF_MODEL_CATALOG_VERSION,
        runtimeReady: false,
        models: [],
      };
    }
  }
}
