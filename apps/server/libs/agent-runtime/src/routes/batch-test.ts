import { Hono } from 'hono';
import type { BatchTestConfig, BatchTestResult } from '../types/index.js';

export const batchTestRouter = new Hono();

// In-memory storage for batch test results
const batchTests = new Map<string, BatchTestResult>();

/**
 * Run batch test
 */
batchTestRouter.post('/', async (c) => {
  const config = await c.req.json<BatchTestConfig>();

  if (!config.blueprintId) {
    return c.json({ error: 'blueprintId is required' }, 400);
  }

  if (!config.concurrency || config.concurrency < 1) {
    return c.json({ error: 'concurrency must be at least 1' }, 400);
  }

  if (!config.inputEvent) {
    return c.json({ error: 'inputEvent is required' }, 400);
  }

  const id = `test_${Date.now()}`;
  const result: BatchTestResult = {
    id,
    status: 'running',
    config,
    instances: [],
    createdAt: Date.now(),
  };

  batchTests.set(id, result);

  // TODO: Actually run the batch test with AgentService
  // For now, just simulate immediate completion
  setTimeout(() => {
    const stored = batchTests.get(id);
    if (stored) {
      stored.status = 'completed';
      stored.completedAt = Date.now();
      stored.summary = {
        totalTime: 0,
        avgTime: 0,
        successRate: 0,
        successCount: 0,
        errorCount: 0,
      };
    }
  }, 100);

  return c.json({ id, status: 'running' }, 202);
});

/**
 * Get batch test result
 */
batchTestRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const result = batchTests.get(id);

  if (!result) {
    return c.json({ error: 'Batch test not found' }, 404);
  }

  return c.json({ result });
});

/**
 * List all batch tests
 */
batchTestRouter.get('/', async (c) => {
  const list = Array.from(batchTests.values()).map((t) => ({
    id: t.id,
    status: t.status,
    config: t.config,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    summary: t.summary,
  }));

  return c.json({ tests: list });
});

/**
 * Delete batch test result
 */
batchTestRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');

  if (!batchTests.has(id)) {
    return c.json({ error: 'Batch test not found' }, 404);
  }

  batchTests.delete(id);
  return c.json({ success: true });
});
