/**
 * Task Lifecycle Reducers
 * Reducer functions for task lifecycle events
 */

import type { MemoryState } from '../../../types/state.types.js';
import type {
  BaseEvent,
  TaskCompletedEvent,
  TaskAbandonedEvent,
  TaskTerminatedEvent,
} from '../../../types/event.types.js';
import type { ReducerResult } from '../../../reducer/reducer.types.js';
import type { ComponentContext } from '../../component.interface.js';
import type { TaskLifecycleData } from './task-lifecycle.types.js';
import { createTaskOutputResult } from './task-lifecycle.operations.js';

/**
 * Reduce TASK_COMPLETED event
 */
export function reduceTaskCompleted(
  componentKey: string,
  _state: MemoryState,
  event: BaseEvent,
  context: ComponentContext,
): ReducerResult {
  const taskEvent = event as TaskCompletedEvent;

  // Update component data with task status
  const lifecycleData: TaskLifecycleData = {
    status: 'completed',
    startedAt: context.getData<number>('startedAt') ?? taskEvent.timestamp,
    endedAt: taskEvent.timestamp,
    result: taskEvent.result,
  };
  context.setData('lifecycle', lifecycleData);

  return createTaskOutputResult({
    componentKey,
    action: 'task_completed',
    eventType: taskEvent.type,
    timestamp: taskEvent.timestamp,
    status: 'completed',
    content: {
      result: taskEvent.result,
      summary: taskEvent.summary,
    },
  });
}

/**
 * Reduce TASK_ABANDONED event
 */
export function reduceTaskAbandoned(
  componentKey: string,
  _state: MemoryState,
  event: BaseEvent,
  context: ComponentContext,
): ReducerResult {
  const taskEvent = event as TaskAbandonedEvent;

  // Update component data with task status
  const lifecycleData: TaskLifecycleData = {
    status: 'abandoned',
    startedAt: context.getData<number>('startedAt') ?? taskEvent.timestamp,
    endedAt: taskEvent.timestamp,
    reason: taskEvent.reason,
  };
  context.setData('lifecycle', lifecycleData);

  return createTaskOutputResult({
    componentKey,
    action: 'task_abandoned',
    eventType: taskEvent.type,
    timestamp: taskEvent.timestamp,
    status: 'abandoned',
    content: {
      reason: taskEvent.reason,
      partialResult: taskEvent.partialResult,
    },
  });
}

/**
 * Reduce TASK_TERMINATED event
 */
export function reduceTaskTerminated(
  componentKey: string,
  _state: MemoryState,
  event: BaseEvent,
  context: ComponentContext,
): ReducerResult {
  const taskEvent = event as TaskTerminatedEvent;

  // Update component data with task status
  const lifecycleData: TaskLifecycleData = {
    status: 'terminated',
    startedAt: context.getData<number>('startedAt') ?? taskEvent.timestamp,
    endedAt: taskEvent.timestamp,
    reason: taskEvent.reason,
    terminatedBy: taskEvent.terminatedBy,
  };
  context.setData('lifecycle', lifecycleData);

  return createTaskOutputResult({
    componentKey,
    action: 'task_terminated',
    eventType: taskEvent.type,
    timestamp: taskEvent.timestamp,
    status: 'terminated',
    content: {
      terminatedBy: taskEvent.terminatedBy,
      reason: taskEvent.reason,
    },
  });
}
