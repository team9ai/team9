/**
 * System Instructions Component
 * Base component for system-level instructions
 */

export { SystemInstructionsComponent } from './system.component.js';
export type { SystemInstructionsComponentConfig } from './system.types.js';
export {
  SYSTEM_CHUNK_KEY,
  createMainInstructionsChunk,
  createContextChunk,
} from './system.operations.js';
