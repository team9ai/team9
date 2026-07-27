import { BadRequestException, HttpException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { ModelChangeUnavailableException } from './model-policy.errors.js';

export function normalizeModelChangeIdempotencyKey(value: unknown): string {
  if (value === undefined) return uuidv7();
  if (typeof value !== 'string') {
    throw new BadRequestException({
      statusCode: 400,
      code: 'invalid_idempotency_key',
      message: 'Idempotency-Key must be a non-empty string',
    });
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'invalid_idempotency_key',
      message: 'Idempotency-Key must contain 1 to 128 characters',
    });
  }
  return normalized;
}

export function modelChangeStatusUrl(attemptId: string): string {
  return `/api/v1/model-changes/${encodeURIComponent(attemptId)}`;
}

export function throwStoredModelChangeRejection(reasonCode: string): never {
  const statusByCode: Record<string, number> = {
    invalid_model_ref: 400,
    unsupported_model: 400,
    model_switch_not_allowed: 403,
    model_manage_forbidden: 403,
    model_policy_target_invalid: 409,
    idempotency_conflict: 409,
  };
  const status = statusByCode[reasonCode];
  if (!status) throw new ModelChangeUnavailableException();
  throw new HttpException(
    {
      statusCode: status,
      code: reasonCode,
      message: 'The model change request was rejected',
    },
    status,
  );
}
