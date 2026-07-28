import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';

export class UnsupportedModelException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      code: 'unsupported_model',
      message: 'The requested model is not supported',
    });
  }
}

export class ModelSwitchNotAllowedException extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      code: 'model_switch_not_allowed',
      message: 'This application does not allow dynamic model switching',
    });
  }
}

export class ModelManageForbiddenException extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      code: 'model_manage_forbidden',
      message: 'The requester cannot manage this channel model',
    });
  }
}

export class ModelPolicyTargetInvalidException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      code: 'model_policy_target_invalid',
      message: 'The model policy target is invalid',
    });
  }
}

export class ModelChangeAuditUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      statusCode: 503,
      code: 'model_change_audit_unavailable',
      message: 'Model change audit storage is unavailable',
    });
  }
}

export class ModelChangeIdempotencyConflictException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      code: 'idempotency_conflict',
      message: 'The idempotency key was already used for another request',
    });
  }
}

export class ModelChangeUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      statusCode: 503,
      code: 'model_change_unavailable',
      message: 'The model change could not be dispatched',
    });
  }
}
