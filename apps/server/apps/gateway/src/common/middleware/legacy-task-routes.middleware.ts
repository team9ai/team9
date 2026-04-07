import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * Temporary backward-compatibility middleware.
 *
 * Rewrites `/v1/tasks/...` → `/v1/routines/...` and
 * `/v1/bot/tasks/...` → `/v1/bot/routines/...` so that
 * already-deployed clients and agent runtimes (Hive / OpenClaw)
 * continue to work during the rename rollout.
 *
 * @deprecated Remove once all clients and agent runtimes are updated.
 */
@Injectable()
export class LegacyTaskRoutesMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (req.url.startsWith('/v1/bot/tasks')) {
      req.url = req.url.replace('/v1/bot/tasks', '/v1/bot/routines');
    } else if (req.url.startsWith('/v1/tasks')) {
      req.url = req.url.replace('/v1/tasks', '/v1/routines');
    }
    next();
  }
}
