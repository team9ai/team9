# Reducer Implementations

This directory contains all concrete EventReducer implementations.

## File Structure

| File                      | Description                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `input.reducer.ts`        | Handles input events: USER_INPUT, SYSTEM_CONTEXT, CONTEXT_INJECTION                                               |
| `llm-response.reducer.ts` | Handles LLM response events: LLM_RESPONSE, LLM_PARTIAL_RESPONSE, LLM_STREAM_END                                   |
| `response.reducer.ts`     | Handles response events: TOOL_CALL, TOOL_RESULT, SKILL_CALL, SKILL_RESULT, CLARIFICATION, THINKING                |
| `error.reducer.ts`        | Handles error events: ERROR, VALIDATION_ERROR, TOOL_ERROR, SKILL_ERROR, NETWORK_ERROR, TIMEOUT_ERROR, FATAL_ERROR |
| `control.reducer.ts`      | Handles control events: TODO_SET, TODO_UPDATED, TODO_DELETED, PAUSE, RESUME, CANCEL, TERMINATE                    |

## Reducer Pattern

Each reducer implements the `EventReducer<T>` interface:

```typescript
interface EventReducer<T extends AgentEvent> {
  readonly eventTypes: EventType[];
  canHandle(event: AgentEvent): event is T;
  reduce(state: MemoryState, event: T): ReducerResult;
}
```

### ReducerResult

```typescript
interface ReducerResult {
  operations: Operation[]; // Operations to apply
  chunks: MemoryChunk[]; // New chunks to add
}
```

## Event → Chunk Mapping

| Event Category | ChunkType    | RetentionStrategy |
| -------------- | ------------ | ----------------- |
| USER_INPUT     | AGENT        | CRITICAL          |
| LLM_RESPONSE   | AGENT        | CRITICAL          |
| TOOL_CALL      | WORKFLOW     | COMPRESSIBLE      |
| TOOL_RESULT    | ENVIRONMENT  | COMPRESSIBLE      |
| THINKING       | WORKING_FLOW | DISPOSABLE        |
| TODO\_\*       | WORKING_FLOW | DISPOSABLE        |
| ERROR          | ENVIRONMENT  | CRITICAL          |

## Adding New Reducer

1. Create new file: `xxx.reducer.ts`
2. Implement `EventReducer<T>` interface
3. Export from `index.ts`
4. Register in `reducer.registry.ts` (parent directory)
5. Update this CLAUDE.md

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Reducer changes may require:

- Adding new EventType in `types/event.types.ts`
- Updating ReducerRegistry
- Adding tests
