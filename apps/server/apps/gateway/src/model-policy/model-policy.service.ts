import { Injectable } from '@nestjs/common';
import { appMetrics } from '@team9/observability';
import {
  STAFF_MODEL_CATALOG,
  STAFF_MODEL_CATALOG_VERSION,
  isUnsafeModelValue,
  type DynamicModelCapability,
  type StaffModelCatalogEntry,
} from './staff-model-catalog.js';
import {
  ModelSwitchNotAllowedException,
  UnsupportedModelException,
} from './model-policy.errors.js';

declare const approvedModel: unique symbol;

export type ApprovedModelRef = Readonly<{
  provider: string;
  id: string;
  catalogVersion: string;
  capability: DynamicModelCapability;
  [approvedModel]: true;
}>;

export interface RequestedModelRef {
  provider: unknown;
  id: unknown;
}

const APPLICATION_CAPABILITIES = new Map<string, DynamicModelCapability>([
  ['common-staff', 'staff'],
  ['personal-staff', 'staff'],
]);

function providerMetricBucket(value: unknown): 'openrouter' | 'other' {
  return value === 'openrouter' ? 'openrouter' : 'other';
}

function recordMetric(action: () => void): void {
  try {
    action();
  } catch {
    // Observability must never weaken or block policy enforcement.
  }
}

@Injectable()
export class ModelPolicyService {
  getCatalog(): readonly StaffModelCatalogEntry[] {
    return STAFF_MODEL_CATALOG.filter((entry) => entry.enabled);
  }

  assertDynamicSwitchAllowed(
    applicationId: string | null | undefined,
  ): DynamicModelCapability {
    if (typeof applicationId !== 'string') {
      throw new ModelSwitchNotAllowedException();
    }
    const capability = APPLICATION_CAPABILITIES.get(applicationId);
    if (!capability) {
      if (applicationId.startsWith('base-model-')) {
        recordMetric(() => {
          appMetrics.modelChangeFixedBotRejectionsTotal.add(1, {
            application: 'base-model',
          });
        });
      }
      throw new ModelSwitchNotAllowedException();
    }
    return capability;
  }

  assertModelAllowed(
    capability: DynamicModelCapability,
    requested: RequestedModelRef,
  ): ApprovedModelRef {
    let provider: string;
    let id: string;
    try {
      provider = this.normalizeValue(requested.provider, 128);
      id = this.normalizeValue(requested.id, 256);
    } catch (error) {
      recordMetric(() => {
        appMetrics.modelChangeUnsupportedTotal.add(1, {
          capability,
          provider: providerMetricBucket(requested.provider),
        });
      });
      throw error;
    }
    const entry = STAFF_MODEL_CATALOG.find(
      (candidate) =>
        candidate.enabled &&
        candidate.capabilities.includes(capability) &&
        candidate.provider === provider &&
        candidate.id === id,
    );

    if (!entry) {
      recordMetric(() => {
        appMetrics.modelChangeUnsupportedTotal.add(1, {
          capability,
          provider: providerMetricBucket(provider),
        });
      });
      throw new UnsupportedModelException();
    }

    const approved = {
      provider: entry.provider,
      id: entry.id,
    } as ApprovedModelRef;
    Object.defineProperties(approved, {
      catalogVersion: {
        value: STAFF_MODEL_CATALOG_VERSION,
        enumerable: false,
      },
      capability: { value: capability, enumerable: false },
    });
    return Object.freeze(approved);
  }

  private normalizeValue(value: unknown, maxLength: number): string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > maxLength ||
      isUnsafeModelValue(value)
    ) {
      throw new UnsupportedModelException();
    }

    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > maxLength) {
      throw new UnsupportedModelException();
    }
    return normalized;
  }
}
