export * from './tool.types.js';
export * from './control/index.js';

import type { ToolDefinition } from './tool.types.js';
import { controlTools } from './control/index.js';

/**
 * All available tools in the framework
 */
export const allTools: ToolDefinition[] = [...controlTools];

/**
 * Get tool definition by name
 */
export function getTool(name: string): ToolDefinition | undefined {
  return allTools.find((t) => t.name === name);
}

/**
 * Get all tool names
 */
export function getAllToolNames(): string[] {
  return allTools.map((t) => t.name);
}

/**
 * Get tools by names
 */
export function getToolsByNames(names: string[]): ToolDefinition[] {
  return names
    .map((name) => getTool(name))
    .filter((t): t is ToolDefinition => t !== undefined);
}
