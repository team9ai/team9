import { describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';
import { LegacyTaskRoutesMiddleware } from './legacy-task-routes.middleware.js';

describe('LegacyTaskRoutesMiddleware', () => {
  it('rewrites full API-prefixed bot task execution status routes to routine routes', () => {
    const middleware = new LegacyTaskRoutesMiddleware();
    const req = {
      url: '/api/v1/bot/tasks/routine-1/executions/execution-1/status',
    } as Request;
    const next = jest.fn();

    middleware.use(req, {} as Response, next);

    expect(req.url).toBe(
      '/api/v1/bot/routines/routine-1/executions/execution-1/status',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
