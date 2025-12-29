import { Hono } from 'hono';
import type { Blueprint } from '../types/index.js';
import { getContext } from '../context.js';

export const blueprintsRouter = new Hono();

/**
 * Create or update blueprint
 */
blueprintsRouter.post('/', async (c) => {
  const blueprint = await c.req.json<Blueprint>();

  if (!blueprint.name) {
    return c.json({ error: 'Blueprint name is required' }, 400);
  }

  const { blueprintService } = getContext();
  const savedBlueprint = await blueprintService.save(blueprint);

  return c.json({ blueprint: savedBlueprint }, 201);
});

/**
 * List all blueprints
 */
blueprintsRouter.get('/', async (c) => {
  const { blueprintService } = getContext();
  const list = await blueprintService.list();
  return c.json({ blueprints: list });
});

/**
 * Get blueprint by ID
 */
blueprintsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const { blueprintService } = getContext();
  const blueprint = await blueprintService.get(id);

  if (!blueprint) {
    return c.json({ error: 'Blueprint not found' }, 404);
  }

  return c.json({ blueprint });
});

/**
 * Update blueprint
 */
blueprintsRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const updates = await c.req.json<Partial<Blueprint>>();
  const { blueprintService } = getContext();

  const updated = await blueprintService.update(id, updates);
  if (!updated) {
    return c.json({ error: 'Blueprint not found' }, 404);
  }

  return c.json({ blueprint: updated });
});

/**
 * Delete blueprint
 */
blueprintsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const { blueprintService } = getContext();

  const exists = await blueprintService.exists(id);
  if (!exists) {
    return c.json({ error: 'Blueprint not found' }, 404);
  }

  await blueprintService.delete(id);
  return c.json({ success: true });
});

/**
 * Validate blueprint
 */
blueprintsRouter.post('/validate', async (c) => {
  const blueprint = await c.req.json<Blueprint>();
  const errors: string[] = [];

  if (!blueprint.name) {
    errors.push('name is required');
  }

  if (!blueprint.initialChunks || blueprint.initialChunks.length === 0) {
    errors.push('initialChunks must have at least one chunk');
  }

  if (!blueprint.llmConfig) {
    errors.push('llmConfig is required');
  } else if (!blueprint.llmConfig.model) {
    errors.push('llmConfig.model is required');
  }

  if (blueprint.subAgents) {
    for (const [key, subAgent] of Object.entries(blueprint.subAgents)) {
      if (!subAgent.name) {
        errors.push(`subAgents.${key}.name is required`);
      }
      if (!subAgent.llmConfig) {
        errors.push(`subAgents.${key}.llmConfig is required`);
      }
    }
  }

  return c.json({
    valid: errors.length === 0,
    errors,
  });
});
