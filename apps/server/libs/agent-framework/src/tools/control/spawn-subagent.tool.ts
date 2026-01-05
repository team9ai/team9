/**
 * Spawn Subagent Tool - Control Tool for delegating tasks to sub-agents
 * Allows the main agent to spawn a sub-agent defined in the blueprint
 */

import type { ToolDefinition } from '../tool.types.js';

export const spawnSubagentTool: ToolDefinition = {
  name: 'spawn_subagent',
  description: `Spawn a sub-agent to handle a delegated task. Use this to delegate work to a specialized sub-agent defined in the blueprint's subAgents configuration.

The sub-agent will execute independently and return results when complete.

Parameters:
- subagent_key: The key identifying which sub-agent to spawn (must match a key in subAgents config)
- task: The task description or prompt to give the sub-agent
- context: Optional additional context or data to pass to the sub-agent

The sub-agent will run with its own blueprint configuration (system prompt, tools, LLM settings).
Results will be returned via SUBAGENT_RESULT event.`,
  parameters: {
    type: 'object',
    properties: {
      subagent_key: {
        type: 'string',
        description:
          'Key identifying the sub-agent to spawn (from subAgents configuration)',
      },
      task: {
        type: 'string',
        description: 'Task description or prompt for the sub-agent',
      },
      context: {
        type: 'object',
        description:
          'Optional additional context or data to pass to the sub-agent',
      },
    },
    required: ['subagent_key', 'task'],
  },
  awaitsExternalResponse: true,
};
