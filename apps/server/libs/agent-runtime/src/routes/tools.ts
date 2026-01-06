import { Hono } from 'hono';
import { allTools, getTool } from '@team9/agent-framework';
import { getContext } from '../context.js';

export const toolsRouter = new Hono();

/**
 * Get all available tools (control tools + external tools)
 */
toolsRouter.get('/', async (c) => {
  // Get control tools from framework
  const controlTools = allTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    awaitsExternalResponse: tool.awaitsExternalResponse,
    parameters: tool.parameters,
    category: 'control',
  }));

  // Get external tools from AgentService
  const { agentService } = getContext();
  const externalTools = agentService.getExternalToolDefinitions();

  return c.json({
    tools: controlTools,
    externalTools,
  });
});

/**
 * Get tool by name
 */
toolsRouter.get('/:name', async (c) => {
  const name = c.req.param('name');
  const tool = getTool(name);

  if (!tool) {
    return c.json({ error: `Tool not found: ${name}` }, 404);
  }

  return c.json({
    tool: {
      name: tool.name,
      description: tool.description,
      awaitsExternalResponse: tool.awaitsExternalResponse,
      parameters: tool.parameters,
    },
  });
});
