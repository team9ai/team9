/**
 * Base Components
 * Core components that provide fundamental agent functionality
 */

export { AbstractComponent } from './abstract-component.js';

// Working History Component
export {
  WorkingHistoryComponent,
  findWorkingHistoryChunk,
  createConversationResult,
  type ConversationResultOptions,
  reduceUserMessage,
  reduceParentAgentMessage,
  reduceLLMTextResponse,
  reduceLLMToolCall,
  reduceLLMSkillCall,
  reduceLLMSubAgentSpawn,
  reduceLLMSubAgentMessage,
  reduceLLMClarification,
  reduceToolResult,
  reduceSkillResult,
  reduceSubAgentResult,
  reduceSubAgentError,
} from './working-history/index.js';

// Task Lifecycle Component
export {
  TaskLifecycleComponent,
  type TaskStatus,
  type TaskLifecycleData,
  createTaskOutputChunk,
  createTaskOutputResult,
  type TaskOutputOptions,
  reduceTaskCompleted,
  reduceTaskAbandoned,
  reduceTaskTerminated,
} from './task-lifecycle/index.js';

// Error Component
export {
  ErrorComponent,
  type ErrorSeverity,
  type ErrorEntry,
  createSystemErrorChunk,
  createSystemErrorResult,
  type SystemErrorChunkOptions,
  reduceToolError,
  reduceSkillError,
  reduceSubAgentError as reduceSubAgentErrorFromErrorComponent,
  reduceSystemError,
} from './error/index.js';
