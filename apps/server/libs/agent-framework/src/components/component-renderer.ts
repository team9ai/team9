/**
 * Component Renderer
 * Converts Components to Chunks and Tools at runtime
 */

import type { ComponentConfig, ComponentType } from './component.types.js';
import {
  COMPONENT_TO_CHUNK_TYPE,
  COMPONENT_TO_TOOL_CATEGORY,
} from './component.types.js';
import type {
  MemoryChunk,
  ChunkContent,
  CreateChunkInput,
} from '../types/chunk.types.js';
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
} from '../types/chunk.types.js';
import type {
  Tool,
  CustomToolConfig,
  ToolCategory,
} from '../tools/tool.types.js';
import { createChunk } from '../factories/chunk.factory.js';

/**
 * Result of rendering components
 */
export interface ComponentRenderResult {
  /** Generated memory chunks */
  chunks: MemoryChunk[];
  /** Tools extracted from components with proper categories */
  tools: Tool[];
}

/**
 * Options for component rendering
 */
export interface ComponentRenderOptions {
  /** Whether to include empty components (no instructions) */
  includeEmpty?: boolean;
}

/**
 * Component Renderer
 * Converts component configurations to memory chunks and tools
 */
export class ComponentRenderer {
  /**
   * Render all components to chunks and tools
   */
  render(
    components: ComponentConfig[],
    options: ComponentRenderOptions = {},
  ): ComponentRenderResult {
    // TODO: 其实还需要提取subagents
    const chunks: MemoryChunk[] = [];
    const tools: Tool[] = [];

    for (const component of components) {
      const result = this.renderComponent(component, options);
      if (result.chunk) {
        chunks.push(result.chunk);
      }
      tools.push(...result.tools);
    }

    return { chunks, tools };
  }

  /**
   * Render a single component
   */
  private renderComponent(
    component: ComponentConfig,
    options: ComponentRenderOptions,
  ): { chunk: MemoryChunk | null; tools: Tool[] } {
    // Skip components without instructions unless includeEmpty is true
    if (!component.instructions && !options.includeEmpty) {
      // Still extract tools even if no instructions
      const tools = this.extractTools(component);
      return { chunk: null, tools };
    }

    // Create chunk from component
    const chunk = this.createChunkFromComponent(component);

    // Extract tools with proper category
    const tools = this.extractTools(component);

    return { chunk, tools };
  }

  /**
   * Create a memory chunk from a component
   */
  private createChunkFromComponent(component: ComponentConfig): MemoryChunk {
    const chunkType = this.getChunkType(component.type);
    const content = this.createContent(component);

    const input: CreateChunkInput = {
      type: chunkType,
      content,
      retentionStrategy: this.getRetentionStrategy(component.type),
      mutable: false,
      priority: this.getPriority(component.type),
      custom: component.customData,
    };

    return createChunk(input);
  }

  /**
   * Get ChunkType from ComponentType
   */
  private getChunkType(componentType: ComponentType): ChunkType {
    const mapping: Record<ComponentType, ChunkType> = {
      system: ChunkType.SYSTEM,
      agent: ChunkType.AGENT,
      workflow: ChunkType.WORKFLOW,
    };
    return mapping[componentType];
  }

  /**
   * Get retention strategy for component type
   */
  private getRetentionStrategy(
    componentType: ComponentType,
  ): ChunkRetentionStrategy {
    // System and Agent components are critical, Workflow is compressible
    const strategies: Record<ComponentType, ChunkRetentionStrategy> = {
      system: ChunkRetentionStrategy.CRITICAL,
      agent: ChunkRetentionStrategy.CRITICAL,
      workflow: ChunkRetentionStrategy.COMPRESSIBLE,
    };
    return strategies[componentType];
  }

  /**
   * Get priority for component type
   */
  private getPriority(componentType: ComponentType): number {
    const priorities: Record<ComponentType, number> = {
      system: 1000,
      agent: 900,
      workflow: 800,
    };
    return priorities[componentType];
  }

  /**
   * Create chunk content from component
   */
  private createContent(component: ComponentConfig): ChunkContent {
    return {
      type: ChunkContentType.TEXT,
      text: component.instructions || '',
    };
  }

  /**
   * Extract tools from component and assign proper category
   */
  private extractTools(component: ComponentConfig): Tool[] {
    if (!component.tools || component.tools.length === 0) {
      return [];
    }

    const category = COMPONENT_TO_TOOL_CATEGORY[component.type];

    return component.tools.map((toolConfig) => ({
      definition: toolConfig.definition,
      executor: toolConfig.executor,
      category: toolConfig.category ?? category,
    }));
  }
}

/**
 * Create a component renderer instance
 */
export function createComponentRenderer(): ComponentRenderer {
  return new ComponentRenderer();
}

/**
 * Helper function to create a SystemComponent
 */
export function createSystemComponent(
  instructions: string,
  tools?: CustomToolConfig[],
  customData?: Record<string, unknown>,
): ComponentConfig {
  return {
    type: 'system',
    instructions,
    tools,
    customData,
  };
}

/**
 * Helper function to create an AgentComponent
 */
export function createAgentComponent(
  instructions?: string,
  tools?: CustomToolConfig[],
  customData?: Record<string, unknown>,
): ComponentConfig {
  return {
    type: 'agent',
    instructions,
    tools,
    customData,
  };
}

/**
 * Helper function to create a WorkflowComponent
 */
export function createWorkflowComponent(
  instructions?: string,
  tools?: CustomToolConfig[],
  customData?: Record<string, unknown>,
): ComponentConfig {
  return {
    type: 'workflow',
    instructions,
    tools,
    customData,
  };
}
