/**
 * TaskLifecycleComponent - Core base component for task lifecycle management
 * Handles task completion, abandonment, and termination events
 *
 * Architecture:
 * - Creates OUTPUT chunks for task lifecycle events
 * - These chunks are marked as CRITICAL and persist in memory
 * - Provides task status tracking via component data
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
import type { TaskStatus, TaskLifecycleData } from './task-lifecycle.types.js';
import {
  reduceTaskCompleted,
  reduceTaskAbandoned,
  reduceTaskTerminated,
} from './task-lifecycle.reducers.js';

/**
 * TaskLifecycleComponent handles task completion events
 * This is a base component that cannot be disabled
 */
export class TaskLifecycleComponent extends AbstractComponent {
  readonly id = 'core:task-lifecycle';
  readonly name = 'Task Lifecycle';
  readonly type: NewComponentType = 'base';

  private static readonly HANDLED_EVENTS = new Set([
    EventType.TASK_COMPLETED,
    EventType.TASK_ABANDONED,
    EventType.TASK_TERMINATED,
  ]);

  // ============ Event Handling ============

  getReducersForEvent(event: AgentEvent): ComponentReducerFn[] {
    if (!TaskLifecycleComponent.HANDLED_EVENTS.has(event.type)) {
      return [];
    }

    switch (event.type) {
      case EventType.TASK_COMPLETED:
        return [
          (state, evt, ctx) => reduceTaskCompleted(this.id, state, evt, ctx),
        ];
      case EventType.TASK_ABANDONED:
        return [
          (state, evt, ctx) => reduceTaskAbandoned(this.id, state, evt, ctx),
        ];
      case EventType.TASK_TERMINATED:
        return [
          (state, evt, ctx) => reduceTaskTerminated(this.id, state, evt, ctx),
        ];
      default:
        return [];
    }
  }

  // ============ Lifecycle Hooks ============

  onInitialize(context: ComponentContext): void {
    // Initialize task as running
    context.setData('startedAt', Date.now());
    const lifecycleData: TaskLifecycleData = {
      status: 'running',
      startedAt: Date.now(),
    };
    context.setData('lifecycle', lifecycleData);
  }

  // ============ Rendering ============

  renderChunk(
    chunk: MemoryChunk,
    _context: ComponentContext,
  ): RenderedFragment[] {
    // Only render OUTPUT chunks from this component
    if (chunk.type !== ChunkType.OUTPUT || chunk.componentId !== this.id) {
      return [];
    }

    const content = chunk.content as {
      action?: string;
      result?: string;
      summary?: string;
      reason?: string;
      partialResult?: string;
      terminatedBy?: string;
    };

    let text = '';

    switch (content.action) {
      case 'task_completed':
        text = `<task_status status="completed">\n`;
        if (content.result) {
          text += `Result: ${content.result}\n`;
        }
        if (content.summary) {
          text += `Summary: ${content.summary}\n`;
        }
        text += `</task_status>`;
        break;

      case 'task_abandoned':
        text = `<task_status status="abandoned">\n`;
        if (content.reason) {
          text += `Reason: ${content.reason}\n`;
        }
        if (content.partialResult) {
          text += `Partial Result: ${content.partialResult}\n`;
        }
        text += `</task_status>`;
        break;

      case 'task_terminated':
        text = `<task_status status="terminated">\n`;
        if (content.terminatedBy) {
          text += `Terminated By: ${content.terminatedBy}\n`;
        }
        if (content.reason) {
          text += `Reason: ${content.reason}\n`;
        }
        text += `</task_status>`;
        break;

      default:
        return [];
    }

    return [
      {
        content: text,
        location: 'system',
        order: 900, // Late in system prompt (task status is dynamic)
      },
    ];
  }

  // ============ Public API ============

  /**
   * Get current task status
   */
  getTaskStatus(context: ComponentContext): TaskStatus {
    const lifecycle = context.getData<TaskLifecycleData>('lifecycle');
    return lifecycle?.status ?? 'running';
  }

  /**
   * Check if task is still running
   */
  isTaskRunning(context: ComponentContext): boolean {
    return this.getTaskStatus(context) === 'running';
  }

  /**
   * Get task lifecycle data
   */
  getTaskLifecycleData(
    context: ComponentContext,
  ): TaskLifecycleData | undefined {
    return context.getData<TaskLifecycleData>('lifecycle');
  }
}
