import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { env } from '@team9/shared';

@Injectable()
export class OpenclawAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    return !!token && token === env.OPENCLAW_AUTH_TOKEN;
  }
}
