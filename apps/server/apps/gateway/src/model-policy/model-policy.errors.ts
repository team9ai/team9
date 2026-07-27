import { BadRequestException, ForbiddenException } from '@nestjs/common';

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
