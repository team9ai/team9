/**
 * Error Component
 * Core base component for error handling
 */

export { ErrorComponent } from './error.component.js';
export type { ErrorSeverity, ErrorEntry } from './error.types.js';
export {
  createSystemErrorChunk,
  createSystemErrorResult,
  type SystemErrorChunkOptions,
} from './error.operations.js';
export {
  reduceToolError,
  reduceSkillError,
  reduceSubAgentError,
  reduceSystemError,
} from './error.reducers.js';
