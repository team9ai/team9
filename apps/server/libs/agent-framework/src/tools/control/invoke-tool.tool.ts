/**
 * Invoke Tool - Control Tool for calling external tools
 * Provides a unified interface for LLM to invoke registered external tools
 */

import type { ToolDefinition } from '../tool.types.js';

export const invokeToolTool: ToolDefinition = {
  name: 'invoke_tool',
  description:
    'Invoke an external tool from the available tools list. Use this to call any tool listed in the [AVAILABLE TOOLS] section. Pass the tool name and its arguments.',
  parameters: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description: 'Name of the tool to invoke (from available tools list)',
      },
      arguments: {
        type: 'object',
        description: 'Arguments to pass to the tool (as key-value pairs)',
      },
    },
    required: ['tool_name'],
  },
  awaitsExternalResponse: true,
};
