# Events and Reducers

This document defines the events that trigger state changes in Agent memory, and their corresponding reducers.

## Overview

```
Event → Reducer → Operations + Chunks → Executor → New State
```

Each event represents a meaningful state transition in the Agent lifecycle. Reducers process events and produce operations that modify the memory state.

---

## 1. Error Events

Events triggered when errors occur during execution.

| Event            | Description                                            | Reducer                |
| ---------------- | ------------------------------------------------------ | ---------------------- |
| `TOOL_ERROR`     | Tool execution failed                                  | `ToolErrorReducer`     |
| `SUBAGENT_ERROR` | SubAgent execution failed                              | `SubAgentErrorReducer` |
| `SKILL_ERROR`    | Skill execution failed                                 | `SkillErrorReducer`    |
| `SYSTEM_ERROR`   | System-level error (timeout, resource exhausted, etc.) | `SystemErrorReducer`   |

**Typical Operations:** Add error chunk, possibly mark related chunks as failed

---

## 2. Input Events

Events triggered by external input (user or parent agent).

| Event                  | Description                         | Reducer                     |
| ---------------------- | ----------------------------------- | --------------------------- |
| `USER_MESSAGE`         | User sends a message                | `UserMessageReducer`        |
| `PARENT_AGENT_MESSAGE` | Parent agent sends task/instruction | `ParentAgentMessageReducer` |

**Typical Operations:** Add input message chunk

---

## 3. LLM Response Events

Events triggered when LLM generates a response.

| Event                  | Description                          | Reducer                     |
| ---------------------- | ------------------------------------ | --------------------------- |
| `LLM_TEXT_RESPONSE`    | LLM generates text response          | `LLMTextResponseReducer`    |
| `LLM_TOOL_CALL`        | LLM requests tool invocation         | `LLMToolCallReducer`        |
| `LLM_SKILL_CALL`       | LLM requests skill invocation        | `LLMSkillCallReducer`       |
| `LLM_SUBAGENT_SPAWN`   | LLM requests to spawn subagent       | `LLMSubAgentSpawnReducer`   |
| `LLM_SUBAGENT_MESSAGE` | LLM sends message to subagent        | `LLMSubAgentMessageReducer` |
| `LLM_CLARIFICATION`    | LLM requests clarification from user | `LLMClarificationReducer`   |

**Typical Operations:** Add response chunk, possibly add pending tool/skill/subagent chunks

---

## 4. Response Events (Tool/Skill/SubAgent)

Events triggered when external invocations return results.

| Event             | Description             | Reducer                 |
| ----------------- | ----------------------- | ----------------------- |
| `TOOL_RESULT`     | Tool returns result     | `ToolResultReducer`     |
| `SKILL_RESULT`    | Skill returns result    | `SkillResultReducer`    |
| `SUBAGENT_RESULT` | SubAgent returns result | `SubAgentResultReducer` |

**Typical Operations:** Add result chunk, update related pending chunks

---

## 5. Control Events

Events triggered by control tool invocations.

### Task Lifecycle

| Event             | Description                   | Reducer                 |
| ----------------- | ----------------------------- | ----------------------- |
| `TASK_COMPLETED`  | Agent reports task completion | `TaskCompletedReducer`  |
| `TASK_ABANDONED`  | Agent abandons task           | `TaskAbandonedReducer`  |
| `TASK_TERMINATED` | Task terminated externally    | `TaskTerminatedReducer` |

### TODO Management

TODO items have statuses: `pending`, `in_progress`, `completed`

The `todo_execute` control tool accepts JS code that can perform multiple operations:

| Event            | Description                     | Reducer                |
| ---------------- | ------------------------------- | ---------------------- |
| `TODO_SET`       | Set/replace TODO plan           | `TodoSetReducer`       |
| `TODO_COMPLETED` | Mark TODO item as completed     | `TodoCompletedReducer` |
| `TODO_EXPANDED`  | Expand TODO item into sub-items | `TodoExpandedReducer`  |
| `TODO_UPDATED`   | Update TODO item content/status | `TodoUpdatedReducer`   |
| `TODO_DELETED`   | Delete TODO item                | `TodoDeletedReducer`   |

The Reducer receives a batch of TODO operations from the JS sandbox execution and generates corresponding events.

### Memory Management

| Event                  | Description                    | Reducer                     |
| ---------------------- | ------------------------------ | --------------------------- |
| `MEMORY_MARK_CRITICAL` | Mark chunk as critical         | `MemoryMarkCriticalReducer` |
| `MEMORY_FORGET`        | Explicitly forget/remove chunk | `MemoryForgetReducer`       |

**Typical Operations:** Update chunk metadata, delete chunks, replace chunks

---

## 6. Memory Compact Events

Events related to memory compaction.

| Event                   | Description                                   | Reducer                |
| ----------------------- | --------------------------------------------- | ---------------------- |
| `MEMORY_COMPACT_MANUAL` | Manually triggered compaction                 | `MemoryCompactReducer` |
| `MEMORY_COMPACT_AUTO`   | Auto-triggered compaction (threshold reached) | `MemoryCompactReducer` |

**Typical Operations:** BatchReplace multiple chunks with compacted chunk

---

## 7. External Events

Events triggered by external system or environment.

| Event                | Description                | Reducer                    |
| -------------------- | -------------------------- | -------------------------- |
| `EXTERNAL_INJECT`    | External context injection | `ExternalInjectReducer`    |
| `EXTERNAL_TIMER`     | Timer/scheduled trigger    | `ExternalTimerReducer`     |
| `ENVIRONMENT_CHANGE` | Environment state change   | `EnvironmentChangeReducer` |

**Typical Operations:** Add environment/context chunks

---

## 8. Lifecycle Events

Events related to Agent execution lifecycle.

| Event              | Description              | Reducer                  |
| ------------------ | ------------------------ | ------------------------ |
| `EXECUTION_RETRY`  | Retry failed operation   | `ExecutionRetryReducer`  |
| `EXECUTION_RESUME` | Resume from paused state | `ExecutionResumeReducer` |
| `EXECUTION_PAUSE`  | Pause execution          | `ExecutionPauseReducer`  |

**Typical Operations:** Add lifecycle marker chunks, update state metadata

---

## Event Base Interface

```typescript
interface BaseEvent {
  type: EventType;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
```

## Reducer Interface

```typescript
interface Reducer<TEvent extends BaseEvent> {
  reduce(state: MemoryState, event: TEvent): ReducerResult;
}

interface ReducerResult {
  operations: Operation[];
  chunks: MemoryChunk[];
}
```

---

## Notes

- Events are immutable records of what happened
- Reducers are pure functions: same event + state = same result
- One event may produce multiple operations
- Reducers should not have side effects
