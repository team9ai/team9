/**
 * Component Types
 * Components are higher-level abstractions that combine chunks and tools
 */

import type { CustomToolConfig } from '../tools/tool.types.js';
import type { ChunkContent } from '../types/chunk.types.js';

/**
 * Component type identifier
 */
export type ComponentType = 'system' | 'agent' | 'workflow';

/**
 * Base component interface
 */
export interface BaseComponent {
  /** Component type */
  type: ComponentType;
  /** Instructions/prompt content for this component */
  instructions?: string;
  /** Tools available in this component's scope */
  tools?: CustomToolConfig[];
  /** Sub-agent keys available in this component's scope (references to blueprint.subAgents) */
  subAgents?: string[];
  /** Additional custom data */
  customData?: Record<string, unknown>;
}

/**
 * System Component
 * Defines system-level instructions and common tools
 * Maps to SYSTEM chunk type and 'common' tool category
 */
export interface SystemComponent extends BaseComponent {
  type: 'system';
  /** System instructions (required) */
  instructions: string;
}

/**
 * Agent Component
 * Defines agent-specific instructions and tools
 * Maps to AGENT chunk type and 'agent' tool category
 */
export interface AgentComponent extends BaseComponent {
  type: 'agent';
  /** Agent-specific instructions */
  instructions?: string;
}

/**
 * Workflow Component
 * Defines workflow-specific instructions and tools
 * Maps to WORKFLOW chunk type and 'workflow' tool category
 */
export interface WorkflowComponent extends BaseComponent {
  type: 'workflow';
  /** Workflow-specific instructions */
  instructions?: string;
}

/**
 * Union type for all component configurations
 */
export type ComponentConfig =
  | SystemComponent
  | AgentComponent
  | WorkflowComponent;

/**
 * Component to ToolCategory mapping
 */
export const COMPONENT_TO_TOOL_CATEGORY: Record<
  ComponentType,
  'common' | 'agent' | 'workflow'
> = {
  system: 'common',
  agent: 'agent',
  workflow: 'workflow',
};

/**
 * Component to ChunkType mapping
 */
export const COMPONENT_TO_CHUNK_TYPE: Record<ComponentType, string> = {
  system: 'SYSTEM',
  agent: 'AGENT',
  workflow: 'WORKFLOW',
};

/**
 * Type guard for SystemComponent
 */
export function isSystemComponent(
  component: ComponentConfig,
): component is SystemComponent {
  return component.type === 'system';
}

/**
 * Type guard for AgentComponent
 */
export function isAgentComponent(
  component: ComponentConfig,
): component is AgentComponent {
  return component.type === 'agent';
}

/**
 * Type guard for WorkflowComponent
 */
export function isWorkflowComponent(
  component: ComponentConfig,
): component is WorkflowComponent {
  return component.type === 'workflow';
}
