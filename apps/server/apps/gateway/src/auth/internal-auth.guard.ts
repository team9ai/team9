import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string | string[] };
    }>();
    const authHeader = request.headers?.authorization;
    const internalAuthValidationToken =
      process.env.INTERNAL_AUTH_VALIDATION_TOKEN;

    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    if (
      typeof internalAuthValidationToken !== 'string' ||
      internalAuthValidationToken.length === 0
    ) {
      throw new UnauthorizedException();
    }

    const bearerToken = authHeader.slice(7);
    if (bearerToken !== internalAuthValidationToken) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
