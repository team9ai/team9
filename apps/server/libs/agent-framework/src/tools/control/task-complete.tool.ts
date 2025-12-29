/**
 * Task Complete Tool
 * Marks the current task as completed and terminates agent
 */

import type { ToolDefinition } from '../tool.types.js';

export const taskCompleteTool: ToolDefinition = {
  name: 'task_complete',
  description:
    'Mark the current task as completed. Use this when you have finished the task successfully.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A brief summary of what was accomplished',
      },
      result: {
        type: 'string',
        description: 'The final result or output of the task',
      },
    },
    required: ['summary'],
  },
  awaitsExternalResponse: true,
};
