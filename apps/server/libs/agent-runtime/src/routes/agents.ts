import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type {
  CreateAgentRequest,
  InjectEventRequest,
  ForkStateRequest,
  EditChunkRequest,
  SetExecutionModeRequest,
} from '../types/index.js';
import { getContext } from '../context.js';
import type { MemoryState, LLMConfig } from '@team9/agent-framework';

export const agentsRouter = new Hono();

/**
 * Helper function to serialize MemoryState for API response
 */
function serializeState(state: MemoryState, version: number) {
  const chunks = Array.from(state.chunks.values());
  return {
    id: state.id,
    threadId: state.threadId,
    version,
    createdAt: state.metadata?.createdAt || Date.now(),
    chunks,
    operationIds: [], // Framework doesn't track this directly
  };
}

/**
 * Helper function to serialize state summary
 */
function serializeStateSummary(state: MemoryState, version: number) {
  return {
    id: state.id,
    threadId: state.threadId,
    version,
    createdAt: state.metadata?.createdAt || Date.now(),
    chunkCount: state.chunks.size,
  };
}

/**
 * Create agent from blueprint
 */
agentsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json<CreateAgentRequest>();
    const { agentService } = getContext();

    const agent = await agentService.createAgent(
      body.blueprint,
      body.modelOverride,
    );

    return c.json({ agent }, 201);
  } catch (error) {
    console.error('Error creating agent:', error);
    return c.json(
      { error: (error as Error).message || 'Failed to create agent' },
      500,
    );
  }
});

/**
 * List all agents
 */
agentsRouter.get('/', async (c) => {
  const { agentService } = getContext();
  const agents = agentService.listAgents();
  return c.json({ agents });
});

/**
 * Get agent by ID
 */
agentsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ agent });
});

/**
 * Delete agent
 */
agentsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const deleted = await agentService.deleteAgent(id);
  if (!deleted) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ success: true });
});

/**
 * Get agent state history
 */
agentsRouter.get('/:id/states', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const states = await agentService.getStateHistory(id);
  return c.json({
    states: states.map((state, index) =>
      serializeStateSummary(state, index + 1),
    ),
  });
});

/**
 * Get specific state
 */
agentsRouter.get('/:id/states/:stateId', async (c) => {
  const id = c.req.param('id');
  const stateId = c.req.param('stateId');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const states = await agentService.getStateHistory(id);
  const stateIndex = states.findIndex((s) => s.id === stateId);
  if (stateIndex === -1) {
    return c.json({ error: 'State not found' }, 404);
  }

  return c.json({
    state: serializeState(states[stateIndex], stateIndex + 1),
  });
});

/**
 * Get current state
 */
agentsRouter.get('/:id/current-state', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Get state history to determine version
  const states = await agentService.getStateHistory(id);
  const state = await agentService.getCurrentState(id);

  if (!state) {
    return c.json({ error: 'State not found' }, 404);
  }

  // Find the index of current state in history
  const version =
    states.findIndex((s) => s.id === state.id) + 1 || states.length || 1;

  return c.json({
    state: serializeState(state, version),
  });
});

/**
 * Inject event into agent
 */
agentsRouter.post('/:id/inject', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  try {
    const body = await c.req.json<InjectEventRequest>();
    // Auto-run LLM based on agent's execution mode (auto mode runs automatically)
    const autoRun = agent.executionMode === 'auto';
    const result = await agentService.injectEvent(id, body.event, autoRun);

    if (!result) {
      return c.json({ error: 'Failed to inject event' }, 500);
    }

    const { dispatchResult, executionResult } = result;

    return c.json({
      success: true,
      result: {
        threadId: dispatchResult.thread.id,
        stateId: dispatchResult.state.id,
        addedChunks: dispatchResult.addedChunks.length,
        removedChunkIds: dispatchResult.removedChunkIds,
      },
      execution: executionResult
        ? {
            success: executionResult.success,
            turnsExecuted: executionResult.turnsExecuted,
            lastResponse: executionResult.lastResponse,
            error: executionResult.error,
          }
        : undefined,
    });
  } catch (error) {
    console.error('Error injecting event:', error);
    return c.json(
      { error: (error as Error).message || 'Failed to inject event' },
      500,
    );
  }
});

/**
 * Fork agent from state
 */
agentsRouter.post('/:id/fork', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  try {
    const body = await c.req.json<ForkStateRequest>();
    const forkedAgent = await agentService.forkFromState(id, body.stateId);

    if (!forkedAgent) {
      return c.json({ error: 'Failed to fork from state' }, 500);
    }

    return c.json({ agent: forkedAgent }, 201);
  } catch (error) {
    console.error('Error forking state:', error);
    return c.json(
      { error: (error as Error).message || 'Failed to fork from state' },
      500,
    );
  }
});

/**
 * Edit chunk in agent
 */
agentsRouter.put('/:id/chunks/:chunkId', async (c) => {
  const id = c.req.param('id');
  const chunkId = c.req.param('chunkId');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  try {
    const body = await c.req.json<EditChunkRequest>();
    const edited = await agentService.editChunk(
      id,
      body.stateId,
      chunkId,
      body.content,
    );

    if (!edited) {
      return c.json({ error: 'Failed to edit chunk' }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error editing chunk:', error);
    return c.json(
      { error: (error as Error).message || 'Failed to edit chunk' },
      500,
    );
  }
});

/**
 * Update agent config (model override)
 */
agentsRouter.put('/:id/config', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  try {
    const body = await c.req.json<{ modelOverride?: LLMConfig }>();
    const updated = agentService.updateConfig(id, body);

    if (!updated) {
      return c.json({ error: 'Failed to update config' }, 500);
    }

    return c.json({ success: true, agent: agentService.getAgent(id) });
  } catch (error) {
    console.error('Error updating config:', error);
    return c.json(
      { error: (error as Error).message || 'Failed to update config' },
      500,
    );
  }
});

/**
 * SSE endpoint for real-time agent events
 */
agentsRouter.get('/:id/events', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return streamSSE(c, async (stream) => {
    // Send initial connection event
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ agentId: id, timestamp: Date.now() }),
    });

    // Subscribe to agent events
    const unsubscribe = agentService.subscribe(id, async (message) => {
      try {
        await stream.writeSSE({
          event: message.type,
          data: JSON.stringify(message.data),
        });
      } catch {
        // Stream closed, will be handled by onAbort
      }
    });

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: 'heartbeat',
          data: JSON.stringify({ timestamp: Date.now() }),
        });
      } catch {
        clearInterval(heartbeat);
      }
    }, 30000);

    // Cleanup on disconnect
    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
      console.log(`SSE connection closed for agent ${id}`);
    });

    // Keep stream open
    await new Promise(() => {});
  });
});

// ============ Execution Mode Control ============

/**
 * Get execution mode status
 */
agentsRouter.get('/:id/execution-mode', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const status = agentService.getExecutionModeStatus(id);
  if (!status) {
    return c.json({ error: 'Failed to get execution mode status' }, 500);
  }

  return c.json({ status });
});

/**
 * Set execution mode
 */
agentsRouter.put('/:id/execution-mode', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  try {
    const body = await c.req.json<SetExecutionModeRequest>();

    if (body.mode !== 'auto' && body.mode !== 'stepping') {
      return c.json(
        { error: 'Invalid mode. Must be "auto" or "stepping"' },
        400,
      );
    }

    const success = await agentService.setExecutionMode(id, body.mode);
    if (!success) {
      return c.json({ error: 'Failed to set execution mode' }, 500);
    }

    const status = agentService.getExecutionModeStatus(id);
    return c.json({ success: true, status });
  } catch (error) {
    console.error('Error setting execution mode:', error);
    return c.json(
      { error: (error as Error).message || 'Failed to set execution mode' },
      500,
    );
  }
});

/**
 * Execute a single step in stepping mode
 */
agentsRouter.post('/:id/step', async (c) => {
  const id = c.req.param('id');
  const { agentService } = getContext();

  const agent = agentService.getAgent(id);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  try {
    const result = await agentService.step(id);
    if (!result) {
      return c.json({ error: 'Failed to step' }, 500);
    }

    return c.json({
      success: true,
      result: {
        compactionPerformed: result.compactionPerformed,
        truncationPerformed: result.truncationPerformed,
        hasPendingOperations: result.hasPendingOperations,
        hasDispatchResult: result.dispatchResult !== null,
        dispatchResult: result.dispatchResult
          ? {
              stateId: result.dispatchResult.state.id,
              addedChunks: result.dispatchResult.addedChunks.length,
              removedChunkIds: result.dispatchResult.removedChunkIds,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Error stepping:', error);
    return c.json({ error: (error as Error).message || 'Failed to step' }, 500);
  }
});
