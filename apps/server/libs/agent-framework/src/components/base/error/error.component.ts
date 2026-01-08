/**
 * ErrorComponent - Core base component for error handling
 * Handles tool errors, skill errors, subagent errors, and system errors
 *
 * Architecture:
 * - Tool/Skill errors are added to WORKING_HISTORY as ACTION_RESPONSE chunks
 * - SubAgent errors are added to WORKING_HISTORY as SUBAGENT_RESULT chunks
 * - System errors create standalone SYSTEM chunks (critical)
 */

import { AbstractComponent } from '../abstract-component.js';
import type { MemoryChunk } from '../../../types/chunk.types.js';
import { ChunkType } from '../../../types/chunk.types.js';
import type { AgentEvent } from '../../../types/event.types.js';
import { EventType } from '../../../types/event.types.js';
import type {
  NewComponentType,
  ComponentContext,
  ComponentReducerFn,
  RenderedFragment,
} from '../../component.interface.js';
import type { ErrorEntry } from './error.types.js';
import {
  reduceToolError,
  reduceSkillError,
  reduceSubAgentError,
  reduceSystemError,
} from './error.reducers.js';

/**
 * ErrorComponent handles all error events
 * This is a base component that cannot be disabled
 */
export class ErrorComponent extends AbstractComponent {
  readonly id = 'core:error';
  readonly name = 'Error Handler';
  readonly type: NewComponentType = 'base';

  private static readonly HANDLED_EVENTS = new Set([
    EventType.TOOL_ERROR,
    EventType.SKILL_ERROR,
    EventType.SUBAGENT_ERROR,
    EventType.SYSTEM_ERROR,
  ]);

  // ============ Event Handling ============

  getReducersForEvent(event: AgentEvent): ComponentReducerFn[] {
    if (!ErrorComponent.HANDLED_EVENTS.has(event.type)) {
      return [];
    }

    switch (event.type) {
      case EventType.TOOL_ERROR:
        return [(state, evt, ctx) => reduceToolError(this.id, state, evt, ctx)];
      case EventType.SKILL_ERROR:
        return [
          (state, evt, ctx) => reduceSkillError(this.id, state, evt, ctx),
        ];
      case EventType.SUBAGENT_ERROR:
        return [
          (state, evt, ctx) => reduceSubAgentError(this.id, state, evt, ctx),
        ];
      case EventType.SYSTEM_ERROR:
        return [
          (state, evt, ctx) => reduceSystemError(this.id, state, evt, ctx),
        ];
      default:
        return [];
    }
  }

  // ============ Rendering ============

  renderChunk(
    chunk: MemoryChunk,
    _context: ComponentContext,
  ): RenderedFragment[] {
    // Only render SYSTEM error chunks from this component
    if (chunk.type !== ChunkType.SYSTEM || chunk.componentId !== this.id) {
      return [];
    }

    const content = chunk.content as {
      errorType?: string;
      code?: string;
      error?: string;
      errorDetails?: unknown;
    };

    if (content.errorType !== 'system_error') {
      return [];
    }

    let text = `<system_error`;
    if (content.code) {
      text += ` code="${content.code}"`;
    }
    text += `>\n`;
    text += content.error ?? 'Unknown system error';
    if (content.errorDetails) {
      text += `\nDetails: ${JSON.stringify(content.errorDetails)}`;
    }
    text += `\n</system_error>`;

    return [
      {
        content: text,
        location: 'system',
        order: 950, // Very late in system prompt (errors are dynamic and important)
      },
    ];
  }

  // ============ Public API ============

  /**
   * Get all tracked errors
   */
  getErrors(context: ComponentContext): ErrorEntry[] {
    return context.getData<ErrorEntry[]>('errors') ?? [];
  }

  /**
   * Get error count by type
   */
  getErrorCount(context: ComponentContext, type?: ErrorEntry['type']): number {
    const counts = context.getData<Record<string, number>>('errorCounts') ?? {};
    if (type) {
      return counts[type] ?? 0;
    }
    return Object.values(counts).reduce((sum, count) => sum + count, 0);
  }

  /**
   * Check if there are any errors
   */
  hasErrors(context: ComponentContext): boolean {
    return this.getErrorCount(context) > 0;
  }

  /**
   * Get most recent error
   */
  getLastError(context: ComponentContext): ErrorEntry | undefined {
    const errors = this.getErrors(context);
    return errors[errors.length - 1];
  }
}
