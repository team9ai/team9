import { BadRequestException, NotFoundException } from '@nestjs/common';

export const RELATION_ERROR_CODES = {
  CYCLE_DETECTED: 'RELATION_CYCLE_DETECTED',
  DEPTH_EXCEEDED: 'RELATION_DEPTH_EXCEEDED',
  SCOPE_VIOLATION: 'RELATION_SCOPE_VIOLATION',
  CARDINALITY_EXCEEDED: 'RELATION_CARDINALITY_EXCEEDED',
  SELF_REFERENCE: 'RELATION_SELF_REFERENCE',
  TARGET_NOT_FOUND: 'RELATION_TARGET_NOT_FOUND',
  DEFINITION_CONFLICT: 'RELATION_DEFINITION_CONFLICT',
  DEFINITION_IMMUTABLE: 'RELATION_DEFINITION_IMMUTABLE',
} as const;

export type RelationErrorCode = keyof typeof RELATION_ERROR_CODES;

export class RelationError extends BadRequestException {
  constructor(
    public readonly errorCode: RelationErrorCode,
    message?: string,
  ) {
    super({
      code: RELATION_ERROR_CODES[errorCode],
      message: message ?? errorCode,
    });
  }
}

export class RelationTargetNotFoundError extends NotFoundException {
  constructor(messageId: string) {
    super({
      code: RELATION_ERROR_CODES.TARGET_NOT_FOUND,
      message: `Target ${messageId} not found or not accessible`,
    });
  }
}

export class RelationSourceNotFoundError extends NotFoundException {
  constructor(messageId: string) {
    super({
      code: RELATION_ERROR_CODES.TARGET_NOT_FOUND, // same code — caller-semantic
      message: `Source message ${messageId} not found or not accessible`,
    });
  }
}
