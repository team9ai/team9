/**
 * Task Abandon Tool
 * Abandons the current task and terminates agent
 */

import type { ToolDefinition } from '../tool.types.js';

export const taskAbandonTool: ToolDefinition = {
  name: 'task_abandon',
  description:
    'Abandon the current task. Use this when you cannot complete the task due to blockers or impossibility.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'The reason for abandoning the task',
      },
    },
    required: ['reason'],
  },
  awaitsExternalResponse: true,
};
