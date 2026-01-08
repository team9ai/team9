/**
 * Task Lifecycle Component
 * Core base component for task lifecycle management
 */

export { TaskLifecycleComponent } from './task-lifecycle.component.js';
export type { TaskStatus, TaskLifecycleData } from './task-lifecycle.types.js';
export {
  createTaskOutputChunk,
  createTaskOutputResult,
  type TaskOutputOptions,
} from './task-lifecycle.operations.js';
export {
  reduceTaskCompleted,
  reduceTaskAbandoned,
  reduceTaskTerminated,
} from './task-lifecycle.reducers.js';
