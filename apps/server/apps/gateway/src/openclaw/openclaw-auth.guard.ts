import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { env } from '@team9/shared';

@Injectable()
export class OpenclawAuthGuard implements CanActivate {
  private getAuthorizationHeader(request: Request): string | null {
    const headers = request.headers as Record<string, unknown>;
    const authorizationHeader = headers.authorization;

    if (typeof authorizationHeader === 'string') {
      return authorizationHeader;
    }

    if (
      Array.isArray(authorizationHeader) &&
      typeof authorizationHeader[0] === 'string'
    ) {
      return authorizationHeader[0];
    }

    return null;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = this.getAuthorizationHeader(req);
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    return !!token && token === env.OPENCLAW_AUTH_TOKEN;
  }
}
