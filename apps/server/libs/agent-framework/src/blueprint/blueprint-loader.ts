import {
  Blueprint,
  BlueprintComponentEntry,
  BlueprintLoadOptions,
  BlueprintLoadResult,
  BlueprintValidationResult,
  BlueprintSchema,
} from './blueprint.types.js';
import { AgentOrchestrator } from '../manager/agent-orchestrator.js';
import type {
  CreateThreadOptions,
  CreateThreadResult,
} from '../manager/memory-manager.interface.js';
import type { Tool } from '../tools/tool.types.js';
import type { IComponent } from '../components/component.interface.js';
import type { IComponentRegistry } from '../components/component-registry.js';
import type { MemoryChunk } from '../types/chunk.types.js';

/**
 * Extended thread creation result with tools and subAgents
 */
export interface CreateThreadFromBlueprintResult extends CreateThreadResult {
  /** Tools extracted from components */
  tools: Tool[];
  /**
   * Sub-agent blueprints defined in the blueprint
   * Key is the subagent name, value is the loaded blueprint
   * These can be used to create subagent threads on-demand
   */
  subAgents: Record<string, Blueprint>;
}

/**
 * BlueprintLoader creates agent threads from blueprint definitions
 */
export class BlueprintLoader {
  constructor(
    private orchestrator: AgentOrchestrator,
    private componentRegistry: IComponentRegistry,
  ) {}

  /**
   * Validate a blueprint definition using Zod schema
   */
  validate(blueprint: Blueprint): BlueprintValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Use Zod for structural validation
    const parseResult = BlueprintSchema.safeParse(blueprint);

    if (!parseResult.success) {
      // Extract error messages from Zod validation
      parseResult.error.issues.forEach((err) => {
        const path = err.path.length > 0 ? `${err.path.join('.')}: ` : '';
        errors.push(`${path}${err.message}`);
      });
    } else {
      // Zod validation passed, now do component-specific validation
      const validBlueprint = parseResult.data;

      // Validate components if present
      if (
        validBlueprint.components &&
        Array.isArray(validBlueprint.components)
      ) {
        validBlueprint.components.forEach((component, index) => {
          const componentResult = this.validateComponent(component, index);
          errors.push(...componentResult.errors);
          warnings.push(...componentResult.warnings);
        });
      }

      // Validate sub-agents recursively
      if (validBlueprint.subAgents) {
        Object.entries(validBlueprint.subAgents).forEach(
          ([key, subBlueprint]) => {
            const subResult = this.validate(subBlueprint);
            subResult.errors.forEach((err) => {
              errors.push(`subAgents.${key}: ${err}`);
            });
            subResult.warnings.forEach((warn) => {
              warnings.push(`subAgents.${key}: ${warn}`);
            });
          },
        );
      }

      // Check for warnings (non-fatal issues)
      const hasComponents =
        validBlueprint.components && validBlueprint.components.length > 0;

      if (!hasComponents) {
        warnings.push('No components defined');
      }

      if (!validBlueprint.tools || validBlueprint.tools.length === 0) {
        warnings.push('No control tools defined');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a single component configuration
   * Instantiates component and calls validateBlueprintConfig if available
   * @returns Object with errors and warnings arrays
   */
  private validateComponent(
    component: BlueprintComponentEntry,
    index: number,
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const prefix = `components[${index}]`;

    // Check componentKey is provided
    if (!component.componentKey) {
      errors.push(`${prefix}: componentKey is required`);
      return { errors, warnings };
    }

    // Get component constructor from registry
    const Constructor = this.componentRegistry.get(component.componentKey);
    if (!Constructor) {
      errors.push(
        `${prefix}: component not registered: ${component.componentKey}`,
      );
      return { errors, warnings };
    }

    // Instantiate component and call validateBlueprintConfig if available
    try {
      const instance = new Constructor(component.config);
      if (typeof instance.validateBlueprintConfig === 'function') {
        const issues = instance.validateBlueprintConfig(component.config || {});
        if (Array.isArray(issues)) {
          issues.forEach((issue) => {
            const message = `${prefix}: ${issue.message}`;
            // Separate errors and warnings based on level
            if (issue.level === 'warning') {
              warnings.push(message);
            } else {
              // Default to error if level is not specified or is 'error'
              errors.push(message);
            }
          });
        }
      }
    } catch (error) {
      errors.push(
        `${prefix}: validation failed - ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { errors, warnings };
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
   * Instantiate component from BlueprintComponentEntry using registry
   */
  private instantiateComponent(entry: BlueprintComponentEntry): IComponent {
    const { componentKey, config } = entry;

    // Get component constructor from registry
    const Constructor = this.componentRegistry.get(componentKey);
    if (!Constructor) {
      throw new Error(`Component not registered: ${componentKey}`);
    }

    // Instantiate component with config
    return new Constructor(config);
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

    // Instantiate components and extract chunks/tools
    let componentChunks: MemoryChunk[] = [];
    let componentTools: Tool[] = [];

    if (loadedBlueprint.components && loadedBlueprint.components.length > 0) {
      for (const entry of loadedBlueprint.components) {
        const componentInstance = this.instantiateComponent(entry);

        // Create a simple context for initial chunk creation
        const context = {
          threadId: '', // Will be set after thread creation
          componentId: componentInstance.id,
          getOwnedChunks: () => [],
          getData: <T>(_key: string): T | undefined => undefined,
          setData: <T>(_key: string, _value: T): void => {},
        };

        // Get initial chunks from component
        const chunks = componentInstance.createInitialChunks(context);
        componentChunks.push(...chunks);

        // Get tools from component
        const tools = componentInstance.getTools();
        componentTools.push(...tools);
      }
    }

    // Create thread with initial chunks and blueprint configuration
    const threadOptions: CreateThreadOptions = {
      initialChunks: componentChunks,
      blueprintId: loadedBlueprint.id,
      blueprintName: loadedBlueprint.name,
      llmConfig: loadedBlueprint.llmConfig,
      tools: loadedBlueprint.tools,
      subAgents: loadedBlueprint.subAgents || {},
    };

    const threadResult = await this.orchestrator.createThread(threadOptions);

    return {
      ...threadResult,
      tools: componentTools,
      subAgents: loadedBlueprint.subAgents || {},
    };
  }

  /**
   * Parse a blueprint from JSON string with validation
   */
  static parseFromJSON(json: string): Blueprint {
    try {
      const parsed = JSON.parse(json);
      const result = BlueprintSchema.safeParse(parsed);

      if (!result.success) {
        const errors = result.error.issues
          .map((err) => {
            const path = err.path.length > 0 ? `${err.path.join('.')}: ` : '';
            return `${path}${err.message}`;
          })
          .join(', ');
        throw new Error(`Invalid blueprint JSON: ${errors}`);
      }

      return result.data;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse blueprint JSON: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Serialize a blueprint to JSON string
   */
  static toJSON(blueprint: Blueprint, pretty = false): string {
    return JSON.stringify(blueprint, null, pretty ? 2 : undefined);
  }
}
