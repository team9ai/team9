/**
 * Built-in Components
 * Pre-built components for common agent functionality
 */

// System Instructions Component
export {
  SystemInstructionsComponent,
  type SystemInstructionsComponentConfig,
  SYSTEM_CHUNK_KEY,
  createMainInstructionsChunk,
  createContextChunk,
} from './system/index.js';

// Todo Component
export {
  TodoComponent,
  type TodoItem,
  TODO_CHUNK_KEY,
  findTodoChunk,
  createTodoChunk,
  createTodoSetResult,
  createTodoUpdateResult,
  reduceTodoSet,
  reduceTodoCompleted,
  reduceTodoExpanded,
  reduceTodoUpdated,
  reduceTodoDeleted,
  formatTodos,
  getStatusIcon,
  updateTodoStatus,
  updateTodoItem,
  expandTodo,
  deleteTodo,
} from './todo/index.js';

// SubAgent Component
export {
  SubAgentComponent,
  type SubAgentInfo,
  STATUS_CHUNK_KEY as SUBAGENT_STATUS_CHUNK_KEY,
  createSubAgentStatusChunk,
} from './subagent/index.js';

// Memory Component
export {
  MemoryComponent,
  type MemoryStats,
  reduceMarkCritical,
  reduceForget,
} from './memory/index.js';
