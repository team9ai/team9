import { Injectable } from '@nestjs/common';
import {
  STAFF_MODEL_CATALOG,
  STAFF_MODEL_CATALOG_VERSION,
  isUnsafeModelValue,
  type DynamicModelCapability,
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
@Injectable()
export class ModelPolicyService {
  assertDynamicSwitchAllowed(
    applicationId: string | null | undefined,
  ): DynamicModelCapability {
    if (typeof applicationId !== 'string') {
      throw new ModelSwitchNotAllowedException();
    }
    const capability = APPLICATION_CAPABILITIES.get(applicationId);
    if (!capability) throw new ModelSwitchNotAllowedException();
    return capability;
  }

  assertModelAllowed(
    capability: DynamicModelCapability,
    requested: RequestedModelRef,
  ): ApprovedModelRef {
    const provider = this.normalizeValue(requested.provider, 128);
    const id = this.normalizeValue(requested.id, 256);
    const entry = STAFF_MODEL_CATALOG.find(
      (candidate) =>
        candidate.enabled &&
        candidate.capabilities.includes(capability) &&
        candidate.provider === provider &&
        candidate.id === id,
    );

    if (!entry) throw new UnsupportedModelException();

    return Object.freeze({
      provider: entry.provider,
      id: entry.id,
      catalogVersion: STAFF_MODEL_CATALOG_VERSION,
      capability,
    }) as ApprovedModelRef;
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
