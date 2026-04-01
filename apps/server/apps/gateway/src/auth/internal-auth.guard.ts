import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { env } from '@team9/shared';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly expectedToken: Buffer;

  constructor() {
    this.expectedToken = Buffer.from(
      env.INTERNAL_AUTH_VALIDATION_TOKEN,
      'utf8',
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string | string[] };
    }>();
    const authHeader = request.headers?.authorization;

    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const provided = Buffer.from(authHeader.slice(7), 'utf8');

    if (
      provided.length !== this.expectedToken.length ||
      !crypto.timingSafeEqual(provided, this.expectedToken)
    ) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
