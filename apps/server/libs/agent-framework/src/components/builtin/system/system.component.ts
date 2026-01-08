/**
 * SystemComponent - Base component for system-level instructions
 * Handles static system prompts and configurations
 *
 * Architecture:
 * - Creates SYSTEM chunks for static instructions
 * - Supports template interpolation for dynamic content
 * - Renders at order 0-100 (static content range)
 */

import { AbstractComponent } from '../../base/abstract-component.js';
import type { MemoryChunk } from '../../../types/chunk.types.js';
import { ChunkType } from '../../../types/chunk.types.js';
import type {
  NewComponentType,
  ComponentContext,
  RenderedFragment,
  ComponentValidationIssue,
} from '../../component.interface.js';
import { renderTemplate } from '../../template-renderer.js';
import type { SystemInstructionsComponentConfig } from './system.types.js';
import {
  createMainInstructionsChunk,
  createContextChunk,
} from './system.operations.js';

/**
 * SystemInstructionsComponent provides static system-level instructions
 * This is a stable component that cannot be disabled at runtime
 *
 * Note: This is distinct from the legacy SystemComponent interface
 * in component.types.ts which is kept for backwards compatibility
 */
export class SystemInstructionsComponent extends AbstractComponent {
  readonly id = 'builtin:system';
  readonly name = 'System Instructions';
  readonly type: NewComponentType = 'stable';

  private config: SystemInstructionsComponentConfig;

  constructor(config: SystemInstructionsComponentConfig) {
    super();
    this.config = config;
  }

  /**
   * Static method to validate blueprint configuration before instantiation
   * This is called during blueprint validation phase
   */
  static validateBlueprintConfig(
    config: unknown,
  ): ComponentValidationIssue[] | null {
    const issues: ComponentValidationIssue[] = [];

    // Check if config is legacy ComponentConfig with type='system'
    if (
      typeof config === 'object' &&
      config !== null &&
      'type' in config &&
      config.type === 'system'
    ) {
      // Legacy ComponentConfig validation
      const legacyConfig = config as { type: string; instructions?: string };

      if (
        !legacyConfig.instructions ||
        legacyConfig.instructions.trim() === ''
      ) {
        issues.push({
          message: 'System component requires instructions',
          level: 'error',
        });
      }

      if (
        legacyConfig.instructions &&
        legacyConfig.instructions.trim().length < 10
      ) {
        issues.push({
          message: 'System instructions are very short (< 10 characters)',
          level: 'warning',
        });
      }
    }
    // Check if config is SystemInstructionsComponentConfig
    else if (
      typeof config === 'object' &&
      config !== null &&
      'instructions' in config
    ) {
      const typedConfig = config as SystemInstructionsComponentConfig;

      if (!typedConfig.instructions || typedConfig.instructions.trim() === '') {
        issues.push({
          message: 'System component requires instructions',
          level: 'error',
        });
      }

      if (
        typedConfig.instructions &&
        typedConfig.instructions.trim().length < 10
      ) {
        issues.push({
          message: 'System instructions are very short (< 10 characters)',
          level: 'warning',
        });
      }
    }

    return issues.length > 0 ? issues : null;
  }

  // ============ Chunk Management ============

  createInitialChunks(_context: ComponentContext): MemoryChunk[] {
    const chunks: MemoryChunk[] = [];

    // Create main instructions chunk
    chunks.push(createMainInstructionsChunk(this.id, this.config.instructions));

    // Create context section chunks
    if (this.config.context) {
      const contextEntries = Object.entries(this.config.context);
      for (const [key, value] of contextEntries) {
        chunks.push(createContextChunk(this.id, key, value));
      }
    }

    return chunks;
  }

  // ============ Rendering ============

  renderChunk(
    chunk: MemoryChunk,
    _context: ComponentContext,
  ): RenderedFragment[] {
    if (chunk.type !== ChunkType.SYSTEM || chunk.componentId !== this.id) {
      return [];
    }

    const content = chunk.content as { type: string; text?: string };
    let text = content.text ?? '';

    // Apply template interpolation if needed
    const custom = chunk.metadata.custom as
      | { hasTemplates?: boolean }
      | undefined;
    if (custom?.hasTemplates && this.config.variables) {
      text = renderTemplate(text, { variables: this.config.variables });
    }

    if (!text.trim()) {
      return [];
    }

    // Determine order based on chunk purpose
    let order = this.config.order ?? 50;
    const customData = chunk.metadata.custom as
      | { isMainInstructions?: boolean; contextKey?: string }
      | undefined;
    if (customData?.contextKey) {
      // Context sections come after main instructions
      order += 10;
    }

    return [
      {
        content: text,
        location: 'system',
        order,
      },
    ];
  }

  // ============ Validation ============

  /**
   * Validate component configuration
   */
  validate(): ComponentValidationIssue[] {
    const issues: ComponentValidationIssue[] = [];

    // Instructions are required for system component
    if (!this.config.instructions || this.config.instructions.trim() === '') {
      issues.push({
        message: 'System component requires instructions',
        level: 'error',
      });
    }

    // Warn if instructions are too short
    if (
      this.config.instructions &&
      this.config.instructions.trim().length < 10
    ) {
      issues.push({
        message: 'System instructions are very short (less than 10 characters)',
        level: 'warning',
      });
    }

    return issues;
  }

  // ============ Public API ============

  /**
   * Update template variables
   */
  updateVariables(variables: Record<string, unknown>): void {
    this.config.variables = { ...this.config.variables, ...variables };
  }

  /**
   * Get current variables
   */
  getVariables(): Record<string, unknown> {
    return { ...this.config.variables };
  }
}
