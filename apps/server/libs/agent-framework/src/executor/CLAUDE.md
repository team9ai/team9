# Executor Module

This directory contains executors for applying operations to state and managing the LLM response generation loop.

## File Structure

| File                    | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `operation.executor.ts` | Operation executor: `applyOperation()`, `applyOperations()`          |
| `executor.types.ts`     | Type definitions: `IToolCallHandler`, `CancellationTokenSource`, etc |
| `llm-loop.executor.ts`  | LLM loop executor: orchestrates turns and manages cancellation       |
| `turn-executor.ts`      | Turn executor: executes a single LLM turn                            |
| `llm-caller.ts`         | LLM caller: handles LLM API calls with timeout/cancellation          |
| `response-parser.ts`    | Response parser: parses LLM responses into BaseEvents                |

## Architecture

```
LLMLoopExecutor
    │
    ├── TurnExecutor (single turn execution)
    │       │
    │       ├── LLMCaller (API call with timeout/cancellation)
    │       │
    │       └── parseResponseToEvents() (response parsing)
    │
    └── CancellationTokenSource (cancellation management)
```

## Operation Executor

### applyOperation

Applies a single Operation to State, returns a new immutable State.

```typescript
import { applyOperation } from './executor';

const newState = applyOperation(state, operation, chunk);
```

### applyOperations

Batch applies multiple Operations.

```typescript
const newState = applyOperations(state, operations, chunks);
```

### Supported Operation Types

| Operation | Description                                              |
| --------- | -------------------------------------------------------- |
| `ADD`     | Add new chunk to state                                   |
| `REMOVE`  | Remove chunk from state                                  |
| `UPDATE`  | Update existing chunk                                    |
| `COMPACT` | Compact operation (replace multiple chunks with new one) |
| `CLEAR`   | Clear state                                              |

## LLM Loop Executor

The `LLMLoopExecutor` orchestrates the LLM response generation loop. It delegates single turn execution to `TurnExecutor`.

### Usage

```typescript
import {
  LLMLoopExecutor,
  IToolCallHandler,
  ToolCallHandlerContext,
  ToolCallHandlerResult,
} from '@team9/agent-framework';

// Create a custom tool handler
class MyToolHandler implements IToolCallHandler {
  canHandle(toolName: string): boolean {
    return toolName === 'my_tool';
  }

  async handle(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolCallHandlerContext,
  ): Promise<ToolCallHandlerResult> {
    // Execute tool logic
    return { shouldContinue: true, resultEvents: [...] };
  }
}

// Create executor with handlers
const executor = new LLMLoopExecutor(memoryManager, llmAdapter, {
  maxTurns: 10,
  timeout: 60000,
  tools: ['ask_user', 'task_complete', 'invoke_tool'],
  toolCallHandlers: [new MyToolHandler()],
});

// Run the loop
const result = await executor.run(threadId);
```

## Turn Executor

The `TurnExecutor` handles a single LLM turn including:

- Building context from memory state
- Calling LLM via `LLMCaller`
- Parsing response via `parseResponseToEvents()`
- Dispatching events
- Handling tool calls

```typescript
import { TurnExecutor, LLMCaller } from '@team9/agent-framework';

const turnExecutor = new TurnExecutor(
  memoryManager,
  contextBuilder,
  llmCaller,
  toolCallHandlers,
);

const result = await turnExecutor.execute(threadId, cancellation);
```

## LLM Caller

The `LLMCaller` handles LLM API calls with timeout and cancellation support.

```typescript
import { LLMCaller } from '@team9/agent-framework';

const caller = new LLMCaller(llmAdapter, toolDefinitions, timeout);
const { response, interaction } = await caller.callWithTimeout(
  messages,
  cancellation,
);
```

## Response Parser

Parses LLM responses into BaseEvents.

```typescript
import { parseResponseToEvents } from '@team9/agent-framework';

const events = parseResponseToEvents(llmResponse);
// Returns: BaseEvent[] (LLM_TEXT_RESPONSE, LLM_TOOL_CALL, etc.)
```

## Cancellation

```typescript
import { CancellationTokenSource } from '@team9/agent-framework';

// Create cancellation source
const cts = new CancellationTokenSource();

// Cancel execution
cts.cancel();

// Check status
if (cts.isCancellationRequested) {
  // ...
}

// Get abort signal for HTTP requests
const signal = cts.signal;
```

## IToolCallHandler Interface

Tool call handlers allow runtime-specific tool execution without coupling the framework to specific implementations.

```typescript
interface IToolCallHandler {
  // Check if this handler can process the tool
  canHandle(toolName: string): boolean;

  // Execute the tool and return result
  handle(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolCallHandlerContext,
  ): Promise<ToolCallHandlerResult>;
}

interface ToolCallHandlerResult {
  // true = continue loop, false = stop and wait
  shouldContinue: boolean;
  // Events to dispatch (e.g., TOOL_RESULT)
  resultEvents?: BaseEvent[];
}
```

## Design Principles

1. **Immutability** - All state operations return new frozen objects
2. **Separation of Concerns** - Loop orchestration, turn execution, LLM calling, and response parsing are separate
3. **Extensibility** - Custom tool handlers can be injected without modifying core code
4. **Cancellation Support** - Native AbortSignal support for cancelling LLM calls

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Changes must ensure:

- Immutability is maintained for Operation Executor
- IToolCallHandler interface remains stable
- Related tests are updated
