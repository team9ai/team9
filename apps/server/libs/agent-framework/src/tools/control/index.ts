/**
 * Control Tools
 * Tools that control agent execution flow (all await external response)
 */

export { waitUserResponseTool } from './ask-user.tool.js';
export { outputTool } from './output.tool.js';
export { taskCompleteTool } from './task-complete.tool.js';
export { taskAbandonTool } from './task-abandon.tool.js';
export { waitParentTool } from './wait-parent.tool.js';

import type { ToolDefinition } from '../tool.types.js';
import { waitUserResponseTool } from './ask-user.tool.js';
import { outputTool } from './output.tool.js';
import { taskCompleteTool } from './task-complete.tool.js';
import { taskAbandonTool } from './task-abandon.tool.js';
import { waitParentTool } from './wait-parent.tool.js';

/**
 * All control tools
 */
export const controlTools: ToolDefinition[] = [
  waitUserResponseTool,
  outputTool,
  taskCompleteTool,
  taskAbandonTool,
  waitParentTool,
];

/**
 * Get control tool by name
 */
export function getControlTool(name: string): ToolDefinition | undefined {
  return controlTools.find((t) => t.name === name);
}

/**
 * Check if a tool is a control tool
 */
export function isControlTool(name: string): boolean {
  return controlTools.some((t) => t.name === name);
}
