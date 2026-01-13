# Working History Component

Core base component for conversation history management. Handles all events related to the conversation flow.

## Overview

The Working History component manages the conversation flow between user, agent, and external systems (tools, skills, subagents).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Working History Architecture                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  WORKING_FLOW chunk (container)                             │
│      │                                                       │
│      ├── childIds: string[] (references to conversation)    │
│      │                                                       │
│      └── Each child is an independent chunk:                │
│          ├── USER_MESSAGE                                   │
│          ├── AGENT_RESPONSE                                 │
│          ├── ACTION_CALL (tool/skill calls)                 │
│          ├── ACTION_RESPONSE (tool/skill results)           │
│          ├── SUBAGENT_SPAWN                                 │
│          └── SUBAGENT_RESULT                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Component Details

| Property | Value                   |
| -------- | ----------------------- |
| ID       | `core:working-history`  |
| Name     | Working History         |
| Type     | `base` (always enabled) |

## Handled Events

| Event Type             | Description                     |
| ---------------------- | ------------------------------- |
| `USER_MESSAGE`         | User input message              |
| `PARENT_AGENT_MESSAGE` | Message from parent agent       |
| `LLM_TEXT_RESPONSE`    | Agent text response             |
| `LLM_TOOL_CALL`        | Agent tool invocation           |
| `LLM_SKILL_CALL`       | Agent skill invocation          |
| `LLM_SUBAGENT_SPAWN`   | Agent spawns subagent           |
| `LLM_SUBAGENT_MESSAGE` | Agent sends message to subagent |
| `LLM_CLARIFICATION`    | Agent asks for clarification    |
| `TOOL_RESULT`          | Tool execution result           |
| `SKILL_RESULT`         | Skill execution result          |
| `SUBAGENT_RESULT`      | Subagent completion result      |
| `SUBAGENT_ERROR`       | Subagent error                  |

## Files

| File                            | Description                     |
| ------------------------------- | ------------------------------- |
| `working-history.component.ts`  | `WorkingHistoryComponent` class |
| `working-history.types.ts`      | Type definitions                |
| `working-history.operations.ts` | Chunk creation operations       |
| `working-history.reducers.ts`   | Event reducer functions         |
| `index.ts`                      | Public exports                  |

## Key Operations

### createConversationResult

Creates chunks for conversation items with proper linking.

```typescript
import { createConversationResult } from '@team9/agent-framework';

const result = createConversationResult({
  state,
  componentKey: 'core:working-history',
  chunkType: ChunkType.USER_MESSAGE,
  content: { type: 'TEXT', text: 'Hello' },
  role: 'user',
});
```

### findWorkingHistoryChunk

Finds the WORKING_FLOW chunk in state.

```typescript
import { findWorkingHistoryChunk } from '@team9/agent-framework';

const workingFlowChunk = findWorkingHistoryChunk(state);
```

## Exports

```typescript
export { WorkingHistoryComponent } from './working-history.component';
export {
  findWorkingHistoryChunk,
  createConversationResult,
  type ConversationResultOptions,
} from './working-history.operations';
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
} from './working-history.reducers';
```
