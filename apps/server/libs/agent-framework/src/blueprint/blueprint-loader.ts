import {
  Blueprint,
  BlueprintChunk,
  BlueprintLoadOptions,
  BlueprintLoadResult,
  BlueprintValidationResult,
} from './blueprint.types.js';
import {
  ChunkType,
  ChunkRetentionStrategy,
  WorkingFlowSubType,
  CreateChunkInput,
} from '../types/chunk.types.js';
import { MemoryManager } from '../manager/memory.manager.js';
import {
  CreateThreadOptions,
  CreateThreadResult,
} from '../manager/thread.manager.js';
import { createChunk } from '../factories/chunk.factory.js';
import { createComponentRenderer } from '../components/component-renderer.js';
import type { Tool } from '../tools/tool.types.js';

/**
 * Extended thread creation result with tools
 */
export interface CreateThreadFromBlueprintResult extends CreateThreadResult {
  /** Tools extracted from components */
  tools: Tool[];
}

/**
 * BlueprintLoader creates agent threads from blueprint definitions
 */
export class BlueprintLoader {
  private componentRenderer = createComponentRenderer();

  constructor(private memoryManager: MemoryManager) {}

  /**
   * Validate a blueprint definition
   */
  validate(blueprint: Blueprint): BlueprintValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!blueprint.name || blueprint.name.trim() === '') {
      errors.push('Blueprint name is required');
    }

    if (!blueprint.llmConfig) {
      errors.push('LLM configuration is required');
    } else {
      if (!blueprint.llmConfig.model) {
        errors.push('LLM model is required');
      }
    }

    // Check for components or initialChunks
    const hasComponents =
      blueprint.components && blueprint.components.length > 0;
    const hasInitialChunks =
      blueprint.initialChunks && blueprint.initialChunks.length > 0;

    // Validate components if present
    if (blueprint.components && Array.isArray(blueprint.components)) {
      blueprint.components.forEach((component, index) => {
        const componentErrors = this.validateComponent(component, index);
        errors.push(...componentErrors);
      });
    }

    // Validate initial chunks if present (for backward compatibility)
    if (blueprint.initialChunks && Array.isArray(blueprint.initialChunks)) {
      blueprint.initialChunks.forEach((chunk, index) => {
        const chunkErrors = this.validateChunk(chunk, index);
        errors.push(...chunkErrors);
      });
    }

    // Validate sub-agents recursively
    if (blueprint.subAgents) {
      Object.entries(blueprint.subAgents).forEach(([key, subBlueprint]) => {
        const subResult = this.validate(subBlueprint);
        subResult.errors.forEach((err) => {
          errors.push(`subAgents.${key}: ${err}`);
        });
        subResult.warnings.forEach((warn) => {
          warnings.push(`subAgents.${key}: ${warn}`);
        });
      });
    }

    // Warnings
    if (!hasComponents && !hasInitialChunks) {
      warnings.push('No components or initial chunks defined');
    }

    if (hasInitialChunks && !hasComponents) {
      warnings.push(
        'Using deprecated initialChunks, consider migrating to components',
      );
    }

    if (!blueprint.tools || blueprint.tools.length === 0) {
      warnings.push('No control tools defined');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a single component definition
   */
  private validateComponent(
    component: { type?: string; instructions?: string },
    index: number,
  ): string[] {
    const errors: string[] = [];
    const prefix = `components[${index}]`;

    if (!component.type) {
      errors.push(`${prefix}: type is required`);
    } else if (!['system', 'agent', 'workflow'].includes(component.type)) {
      errors.push(`${prefix}: invalid type '${component.type}'`);
    }

    // System component requires instructions
    if (component.type === 'system' && !component.instructions) {
      errors.push(`${prefix}: system component requires instructions`);
    }

    return errors;
  }

  /**
   * Validate a single chunk definition
   */
  private validateChunk(chunk: BlueprintChunk, index: number): string[] {
    const errors: string[] = [];
    const prefix = `initialChunks[${index}]`;

    if (!chunk.type) {
      errors.push(`${prefix}: type is required`);
    } else if (!Object.values(ChunkType).includes(chunk.type as ChunkType)) {
      errors.push(`${prefix}: invalid type '${chunk.type}'`);
    }

    if (!chunk.content) {
      errors.push(`${prefix}: content is required`);
    } else {
      if (!chunk.content.type) {
        errors.push(`${prefix}: content.type is required`);
      }
    }

    if (
      chunk.retentionStrategy &&
      !Object.values(ChunkRetentionStrategy).includes(
        chunk.retentionStrategy as ChunkRetentionStrategy,
      )
    ) {
      errors.push(
        `${prefix}: invalid retentionStrategy '${chunk.retentionStrategy}'`,
      );
    }

    if (
      chunk.type === ChunkType.WORKING_FLOW &&
      chunk.subType &&
      !Object.values(WorkingFlowSubType).includes(
        chunk.subType as WorkingFlowSubType,
      )
    ) {
      errors.push(`${prefix}: invalid subType '${chunk.subType}'`);
    }

    return errors;
  }

  /**
   * Load a blueprint and apply optional overrides
   */
  load(
    blueprint: Blueprint,
    options?: BlueprintLoadOptions,
  ): BlueprintLoadResult {
    const warnings: string[] = [];

    // Apply overrides
    const loadedBlueprint: Blueprint = {
      ...blueprint,
      llmConfig: {
        ...blueprint.llmConfig,
        ...options?.llmConfigOverride,
      },
    };

    if (options?.autoCompactThresholdOverride !== undefined) {
      loadedBlueprint.autoCompactThreshold =
        options.autoCompactThresholdOverride;
    }

    // Validate after applying overrides
    const validation = this.validate(loadedBlueprint);
    if (!validation.valid) {
      throw new Error(`Invalid blueprint: ${validation.errors.join(', ')}`);
    }
    warnings.push(...validation.warnings);

    return {
      blueprint: loadedBlueprint,
      warnings,
    };
  }

  /**
   * Create a thread from a blueprint
   * Returns the thread, initial state, and tools extracted from components
   */
  async createThreadFromBlueprint(
    blueprint: Blueprint,
    options?: BlueprintLoadOptions,
  ): Promise<CreateThreadFromBlueprintResult> {
    // Load and validate blueprint
    const { blueprint: loadedBlueprint } = this.load(blueprint, options);

    // Render components to chunks and tools
    let componentChunks: ReturnType<typeof createChunk>[] = [];
    let componentTools: Tool[] = [];

    if (loadedBlueprint.components && loadedBlueprint.components.length > 0) {
      const renderResult = this.componentRenderer.render(
        loadedBlueprint.components,
      );
      componentChunks = renderResult.chunks;
      componentTools = renderResult.tools;
    }

    // Convert legacy blueprint chunks to MemoryChunk (backward compatibility)
    // eslint-disable-next-line deprecation/deprecation
    const legacyChunks = (loadedBlueprint.initialChunks || []).map(
      (blueprintChunk) =>
        createChunk(this.convertBlueprintChunk(blueprintChunk)),
    );

    // Combine component chunks and legacy chunks
    // Component chunks come first, then legacy chunks
    const allChunks = [...componentChunks, ...legacyChunks];

    // Create thread with initial chunks
    const threadOptions: CreateThreadOptions = {
      initialChunks: allChunks,
      custom: {
        blueprintId: loadedBlueprint.id,
        blueprintName: loadedBlueprint.name,
        tools: loadedBlueprint.tools,
        llmConfig: loadedBlueprint.llmConfig,
        hasComponents: (loadedBlueprint.components?.length ?? 0) > 0,
      },
    };

    const threadResult = await this.memoryManager.createThread(threadOptions);

    return {
      ...threadResult,
      tools: componentTools,
    };
  }

  /**
   * Convert a blueprint chunk to CreateChunkInput
   */
  private convertBlueprintChunk(
    blueprintChunk: BlueprintChunk,
  ): CreateChunkInput {
    return {
      type: blueprintChunk.type as ChunkType,
      subType: blueprintChunk.subType as WorkingFlowSubType | undefined,
      content: blueprintChunk.content,
      retentionStrategy:
        (blueprintChunk.retentionStrategy as ChunkRetentionStrategy) ||
        ChunkRetentionStrategy.CRITICAL,
      mutable: blueprintChunk.mutable ?? false,
      priority: blueprintChunk.priority ?? 0,
    };
  }

  /**
   * Parse a blueprint from JSON string
   */
  static parseFromJSON(json: string): Blueprint {
    try {
      return JSON.parse(json) as Blueprint;
    } catch (error) {
      throw new Error(
        `Failed to parse blueprint JSON: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Serialize a blueprint to JSON string
   */
  static toJSON(blueprint: Blueprint, pretty = false): string {
    return JSON.stringify(blueprint, null, pretty ? 2 : undefined);
  }
}
