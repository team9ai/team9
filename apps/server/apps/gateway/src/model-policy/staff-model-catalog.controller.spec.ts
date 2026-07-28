import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { Response } from 'express';
import { appMetrics } from '@team9/observability';
import { ModelPolicyService } from './model-policy.service.js';
import { StaffModelCatalogController } from './staff-model-catalog.controller.js';
import { STAFF_MODEL_CATALOG_VERSION } from './staff-model-catalog.js';

describe('StaffModelCatalogController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the Team9-owned enabled catalog without a worker-readiness dependency', async () => {
    const add = jest.fn();
    jest
      .spyOn(appMetrics, 'modelCatalogReadinessTotal', 'get')
      .mockReturnValue({ add } as never);
    const setHeader = jest.fn();
    const controller = new StaffModelCatalogController(
      new ModelPolicyService(),
    );

    const response = controller.getCatalog({
      setHeader,
    } as unknown as Response);

    expect(response.runtimeReady).toBe(true);
    expect(response.catalogVersion).toBe(STAFF_MODEL_CATALOG_VERSION);
    expect(response.models).toHaveLength(12);
    expect(response.models.filter((model) => model.default)).toHaveLength(1);
    expect(setHeader).toHaveBeenCalledWith(
      'ETag',
      `"${STAFF_MODEL_CATALOG_VERSION}"`,
    );
    expect(JSON.stringify(response).toLowerCase()).not.toMatch(
      /credential|entitlement|tenant|price/,
    );
    expect(add).toHaveBeenCalledWith(1, {
      catalog_version: STAFF_MODEL_CATALOG_VERSION,
      runtime_ready: 'true',
      outcome: 'ready',
    });
  });
});
