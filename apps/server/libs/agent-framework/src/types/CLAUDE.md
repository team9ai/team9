# Memory Types

This directory defines core type definitions for the Agent Memory Context system.

## File Structure

| File                 | Description                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `chunk.types.ts`     | Memory Chunk types: ChunkType, ChunkContentType, ChunkRetentionStrategy, MemoryChunk                   |
| `state.types.ts`     | Memory State types: MemoryState (immutable state container)                                            |
| `operation.types.ts` | Operation types: OperationType, Operation (ADD, REMOVE, UPDATE, COMPACT, CLEAR)                        |
| `thread.types.ts`    | Thread types: Thread, ThreadMetadata (supports multi-thread conversations)                             |
| `event.types.ts`     | Event type definitions: EventType enum (27+ event types), AgentEvent union type, EventDispatchStrategy |
| `agent.types.ts`     | Agent types: AgentStatus (processing, waiting_internal, awaiting_input, paused, completed, error)      |

## Core Concepts

### ChunkType

- `SYSTEM` - System context (system prompts, instructions)
- `AGENT` - Agent's own contextual information (assistant responses)
- `WORKFLOW` - Workflow operations (tool calls, skill calls)
- `DELEGATION` - Sub-agent delegation (parent agent messages)
- `ENVIRONMENT` - Environment feedback (tool results)
- `WORKING_FLOW` - Agent's current working flow context, with subtypes:
  - `USER` - User messages, interjections, interventions
  - `THINKING` - Agent thinking process
  - `RESPONSE` - Intermediate responses from agent
  - `AGENT_ACTION` - Agent actions (MCP, Skill, SubAgent calls)
  - `ACTION_RESPONSE` - Response to agent actions
  - `COMPACTED` - Summarized/compressed context
- `OUTPUT` - Task final output

### ChunkRetentionStrategy

- `CRITICAL` - Critical content, cannot be compressed
- `COMPRESSIBLE` - Can be compressed
- `BATCH_COMPRESSIBLE` - Can be batch compressed
- `DISPOSABLE` - Can be discarded
- `EPHEMERAL` - Temporary

### AgentStatus

Agent lifecycle status:

- `processing` - Agent is actively generating content or executing LLM calls
- `waiting_internal` - Agent is waiting for sub-agent or tool to return
- `awaiting_input` - Agent is waiting for external input (human/external system)
- `paused` - Agent is paused in stepping mode, waiting for manual step
- `completed` - Agent has completed its task
- `error` - Agent encountered an error

### EventDispatchStrategy

Strategy for handling event dispatch when agent is processing:

- `queue` - (default) Queue the event, process after current operation completes
- `interrupt` - Cancel current generation, immediately process new event
- `terminate` - End the agent's event loop, transition to completed/error state
- `silent` - Store only, do not trigger any processing flow (reserved for future use)

Default strategies by event type:

- `TASK_COMPLETED`, `TASK_ABANDONED`, `TASK_TERMINATED` → `terminate`
- All other events → `queue`

Events can override their default strategy via `BaseEvent.dispatchStrategy`.

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Type changes may affect:

- `factories/` - Factory functions
- `reducer/` - Event handlers
- `context/` - Context builder
