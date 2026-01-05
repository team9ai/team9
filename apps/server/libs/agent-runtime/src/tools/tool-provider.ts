/**
 * Tool Provider
 * Manages external tool registration and configuration
 */

import type { CustomToolConfig } from '@team9/agent-framework';
import {
  createSemrushApiTool,
  type SemrushApiToolConfig,
} from './semrush-api.tool.js';

/**
 * Configuration for external tools
 */
export interface ExternalToolsConfig {
  /** Enable Semrush API tool */
  semrush?: SemrushApiToolConfig | boolean;
}

/**
 * Get default external tools configuration from environment
 */
export function getDefaultToolsConfig(): ExternalToolsConfig {
  const config: ExternalToolsConfig = {};

  // Enable Semrush if API key is set
  if (process.env.SEMRUSH_API_KEY) {
    config.semrush = {
      apiKey: process.env.SEMRUSH_API_KEY,
    };
  }

  return config;
}

/**
 * Create external tools based on configuration
 */
export function createExternalTools(
  config: ExternalToolsConfig = getDefaultToolsConfig(),
): CustomToolConfig[] {
  const tools: CustomToolConfig[] = [];

  // Add Semrush tool if configured
  if (config.semrush) {
    const semrushConfig =
      typeof config.semrush === 'boolean' ? {} : config.semrush;
    const semrushTool = createSemrushApiTool(semrushConfig);
    tools.push({
      definition: semrushTool.definition,
      executor: semrushTool.executor,
      category: semrushTool.category,
    });
  }

  return tools;
}

/**
 * Get available external tool names
 */
export function getExternalToolNames(
  config: ExternalToolsConfig = getDefaultToolsConfig(),
): string[] {
  const names: string[] = [];

  if (config.semrush) {
    names.push('semrush_api');
  }

  return names;
}
