import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * Temporary backward-compatibility middleware.
 *
 * Rewrites only legacy bot task execution routes:
 * `/v1/bot/tasks/...` → `/v1/bot/routines/...`.
 *
 * User-facing `/v1/tasks` is now the independent task-run API and must not
 * be rewritten to routines.
 *
 * @deprecated Remove once all clients and agent runtimes are updated.
 */
@Injectable()
export class LegacyTaskRoutesMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (req.url.startsWith('/api/v1/bot/tasks')) {
      req.url = req.url.replace('/api/v1/bot/tasks', '/api/v1/bot/routines');
    } else if (req.url.startsWith('/v1/bot/tasks')) {
      req.url = req.url.replace('/v1/bot/tasks', '/v1/bot/routines');
    }
    next();
  }
}
