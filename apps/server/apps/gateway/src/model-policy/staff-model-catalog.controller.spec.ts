import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { Response } from 'express';
import type { HiveWorkerFleetReadiness } from '@team9/claw-hive';
import { appMetrics } from '@team9/observability';
import { ModelPolicyService } from './model-policy.service.js';
import { StaffModelCatalogController } from './staff-model-catalog.controller.js';
import { STAFF_MODEL_CATALOG_VERSION } from './staff-model-catalog.js';

function readiness(
  minimum: string,
  readyForQueueV2 = true,
): HiveWorkerFleetReadiness {
  return {
    queueProtocolVersion: {
      minimum: readyForQueueV2 ? 2 : 1,
      incompatibleWorkerIds: readyForQueueV2 ? [] : ['worker-old'],
    },
    resolverCapabilityVersion: {
      minimum,
      versions: { [minimum]: 1 },
    },
    readyForQueueV2,
    rolloutGates: {
      protocolV2AssignmentEnabled: false,
      retryPromotionEnabled: false,
      operatorMutationEnabled: false,
    },
  };
}

describe('StaffModelCatalogController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the enabled versioned catalog and ETag when the fleet is ready', async () => {
    const add = jest.fn();
    jest
      .spyOn(appMetrics, 'modelCatalogReadinessTotal', 'get')
      .mockReturnValue({ add } as never);
    const hive = {
      getWorkerFleetReadiness: jest
        .fn<() => Promise<HiveWorkerFleetReadiness>>()
        .mockResolvedValue(readiness('1.0.0')),
    };
    const setHeader = jest.fn();
    const controller = new StaffModelCatalogController(
      new ModelPolicyService(),
      hive as never,
    );

    const response = await controller.getCatalog({
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

  it('hides models whose minimum resolver capability is not fleet-wide', async () => {
    const hive = {
      getWorkerFleetReadiness: jest
        .fn<() => Promise<HiveWorkerFleetReadiness>>()
        .mockResolvedValue(readiness('0.9.0')),
    };
    const controller = new StaffModelCatalogController(
      new ModelPolicyService(),
      hive as never,
    );

    const response = await controller.getCatalog({
      setHeader: jest.fn(),
    } as unknown as Response);

    expect(response).toMatchObject({
      runtimeReady: false,
      models: [],
    });
  });

  it('fails closed without leaking an upstream error when readiness is down', async () => {
    const hive = {
      getWorkerFleetReadiness: jest
        .fn<() => Promise<HiveWorkerFleetReadiness>>()
        .mockRejectedValue(new Error('redis password=secret')),
    };
    const controller = new StaffModelCatalogController(
      new ModelPolicyService(),
      hive as never,
    );

    await expect(
      controller.getCatalog({
        setHeader: jest.fn(),
      } as unknown as Response),
    ).resolves.toMatchObject({
      runtimeReady: false,
      models: [],
    });
  });
});
