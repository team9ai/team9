/**
 * Wait User Response Tool
 * Pauses agent execution and waits for user to provide input
 * This is a signal to stop the agent loop and wait for the next user message
 */

import type { ToolDefinition } from '../tool.types.js';

export const waitUserResponseTool: ToolDefinition = {
  name: 'wait_user_response',
  description:
    'Stop execution and wait for the user to respond. IMPORTANT: You MUST first provide a text response to the user (greeting, answer, question, or prompt) BEFORE calling this tool. Never call this tool without first outputting something for the user to read. After your text response, call this tool to pause and wait for user input.',
  parameters: {
    type: 'object',
    properties: {},
  },
  awaitsExternalResponse: true,
};
