/**
 * Agent status
 * - processing: Agent is actively generating content or executing LLM calls
 * - waiting_internal: Agent is waiting for sub-agent or tool to return
 * - awaiting_input: Agent is waiting for external input (human/external system)
 * - paused: Agent is paused in stepping mode, waiting for manual step
 * - completed: Agent has completed its task
 * - error: Agent encountered an error
 */
export type AgentStatus =
  | 'processing'
  | 'waiting_internal'
  | 'awaiting_input'
  | 'paused'
  | 'completed'
  | 'error';
