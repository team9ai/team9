# Executor Module

This directory contains two types of executors:

1. **Operation Executor** - Applies Operations to MemoryState (state transitions)
2. **LLM Loop Executor** - Manages the LLM response generation loop

## File Structure

| File                    | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `operation.executor.ts` | Operation executor: `applyOperation()`, `applyOperations()`          |
| `executor.types.ts`     | Type definitions: `IToolCallHandler`, `CancellationTokenSource`, etc |
| `llm-loop.executor.ts`  | LLM loop executor: `LLMLoopExecutor` class                           |

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

The `LLMLoopExecutor` handles the core LLM response generation loop. It is designed to be runtime-agnostic by delegating tool execution to `IToolCallHandler` implementations.

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

### Cancellation

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

### IToolCallHandler Interface

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
  resultEvents?: AgentEvent[];
}
```

## Design Principles

1. **Immutability** - All state operations return new frozen objects
2. **Separation of Concerns** - LLM loop logic is framework-level, tool execution is runtime-level
3. **Extensibility** - Custom tool handlers can be injected without modifying core code
4. **Cancellation Support** - Native AbortSignal support for cancelling LLM calls

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Changes must ensure:

- Immutability is maintained for Operation Executor
- IToolCallHandler interface remains stable
- Related tests are updated
