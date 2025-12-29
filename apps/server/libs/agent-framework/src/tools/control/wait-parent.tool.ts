/**
 * Wait Parent Tool
 * For sub-agents to wait for parent agent response
 */

import type { ToolDefinition } from '../tool.types.js';

export const waitParentTool: ToolDefinition = {
  name: 'wait_parent',
  description:
    'Wait for response or guidance from the parent agent. Use this as a sub-agent when you need input from your parent.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Message to the parent agent explaining what you need',
      },
    },
    required: ['message'],
  },
  awaitsExternalResponse: true,
};
