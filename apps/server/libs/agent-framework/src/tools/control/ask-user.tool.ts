/**
 * Ask User Tool
 * Pauses agent execution to ask user for input/clarification
 */

import type { ToolDefinition } from '../tool.types.js';

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description:
    'Ask the user a question or request clarification. Use this when you need more information from the user to proceed with the task.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user',
      },
    },
    required: ['question'],
  },
  awaitsExternalResponse: true,
};
