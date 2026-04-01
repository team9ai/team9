import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import * as Sentry from '@sentry/nestjs';
import type { JwtPayload } from '@team9/auth';

type AuthenticatedRequest = Request & {
  user?: JwtPayload & { id?: string };
};

@Injectable()
export class SentryUserInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (user) {
      Sentry.setUser({
        id: user.id ?? user.sub,
        email: user.email,
      });
    }

    return next.handle();
  }
}
