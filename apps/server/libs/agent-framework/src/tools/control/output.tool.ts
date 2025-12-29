/**
 * Output Tool
 * Outputs response/report to user or parent agent
 */

import type { ToolDefinition } from '../tool.types.js';

export const outputTool: ToolDefinition = {
  name: 'output',
  description:
    'Output a response or report to the user or parent agent. Use this to communicate results, progress, or final answers.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The content to output',
      },
      type: {
        type: 'string',
        enum: ['message', 'report', 'result', 'progress'],
        description: 'The type of output',
      },
    },
    required: ['content'],
  },
  awaitsExternalResponse: true,
};
