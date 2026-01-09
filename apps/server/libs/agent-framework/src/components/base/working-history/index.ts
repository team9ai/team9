/**
 * Working History Component
 * Core base component for conversation history management
 */

export { WorkingHistoryComponent } from './working-history.component.js';
export {
  findWorkingHistoryChunk,
  createConversationResult,
  type ConversationResultOptions,
} from './working-history.operations.js';
export {
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
} from './working-history.reducers.js';
export {
  // Compaction operations
  compactWorkingHistory,
  createCompactionResult,
  shouldTriggerCompaction,
  hasCompressibleChunks,
  isCompressibleChunk,
  getRetainedChunks,
  extractChunkText,
  type CompactionTriggerOptions,
} from './working-history.compactor.js';
export type {
  CompactionResult,
  CompactionConfig,
} from './working-history.types.js';
