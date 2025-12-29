# Tools System

Tool system for the agent framework, providing control tools and custom tool registration.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Tool Categories                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Control Tools - Framework built-in, LLM direct call  │
│     └─ wait_user_response, output, task_complete        │
│     └─ task_abandon, wait_parent                        │
│     └─ invoke_tool (calls external tools)               │
│                                                          │
│  2. Common Tools - Global, via invoke_tool               │
│     └─ read_file, search, web_fetch...                  │
│                                                          │
│  3. Agent Tools - Agent-specific, via invoke_tool        │
│     └─ Custom tools for specific agents                 │
│                                                          │
│  4. Workflow Tools - Workflow-specific, via invoke_tool  │
│     └─ Custom tools for specific workflows              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Directory Structure

```
tools/
├── tool.types.ts      # Type definitions
├── tool.registry.ts   # ToolRegistry implementation
├── index.ts           # Main exports
├── CLAUDE.md          # This file
└── control/           # Control tools
    ├── ask-user.tool.ts      # wait_user_response
    ├── output.tool.ts        # output
    ├── task-complete.tool.ts # task_complete
    ├── task-abandon.tool.ts  # task_abandon
    ├── wait-parent.tool.ts   # wait_parent
    ├── invoke-tool.tool.ts   # invoke_tool (NEW)
    └── index.ts              # Control tools exports
```

## Core Types

### ToolCategory

```typescript
type ToolCategory = 'control' | 'common' | 'agent' | 'workflow';
```

| Category   | Description                          | Direct LLM Call |
| ---------- | ------------------------------------ | --------------- |
| `control`  | Framework built-in tools             | Yes             |
| `common`   | Global tools available to all agents | No (via invoke) |
| `agent`    | Tools specific to an agent           | No (via invoke) |
| `workflow` | Tools specific to a workflow         | No (via invoke) |

### ToolDefinition

Definition passed to LLM for tool calling:

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  awaitsExternalResponse?: boolean; // If true, execution stops until result injected
}
```

### ToolExecutor

Function that executes a tool:

```typescript
type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolResult>;
```

### ToolExecutionContext

```typescript
interface ToolExecutionContext {
  threadId: string;
  agentId?: string;
  callId: string;
  signal?: AbortSignal; // For cancellation
}
```

### ToolResult

```typescript
interface ToolResult {
  callId: string;
  success: boolean;
  content: unknown;
  error?: string;
}
```

### Tool

Complete tool with definition and executor:

```typescript
interface Tool {
  definition: ToolDefinition;
  executor: ToolExecutor;
  category: ToolCategory;
}
```

### CustomToolConfig

Simplified config for user-defined tools:

```typescript
interface CustomToolConfig {
  definition: ToolDefinition;
  executor: ToolExecutor;
  category?: ToolCategory; // Defaults to 'common'
}
```

## Control Tools

Control tools are framework built-in and LLM calls them directly.

| Tool                 | Description            | Awaits Response |
| -------------------- | ---------------------- | --------------- |
| `wait_user_response` | Wait for user input    | Yes             |
| `output`             | Output content to user | Yes             |
| `task_complete`      | Mark task as completed | Yes             |
| `task_abandon`       | Abandon current task   | Yes             |
| `wait_parent`        | Wait for parent agent  | Yes             |
| `invoke_tool`        | Invoke external tool   | Yes             |

### invoke_tool

The key control tool for calling external tools:

```typescript
// LLM calls this to invoke any tool from the available tools list
invoke_tool({
  tool_name: 'read_file', // Name of tool to call
  arguments: { path: '/foo' }, // Arguments to pass
});
```

## ToolRegistry

Manages tool registration, lookup, and execution.

### Interface

```typescript
interface IToolRegistry {
  // Registration
  register(tool: Tool): void;
  registerAll(tools: Tool[]): void;
  unregister(name: string): void;

  // Lookup
  getTool(name: string): Tool | undefined;
  getDefinition(name: string): ToolDefinition | undefined;
  getExecutor(name: string): ToolExecutor | undefined;
  has(name: string): boolean;
  getAllToolNames(): string[];
  getToolsByCategory(category: ToolCategory): Tool[];
  getDefinitionsByNames(names: string[]): ToolDefinition[];

  // Execution
  execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult>;

  // Context generation
  formatToolListForContext(): string;
}
```

### Usage

```typescript
import {
  createDefaultToolRegistry,
  ToolRegistry,
} from '@team9/agent-framework';

// Create registry with control tools pre-registered
const registry = createDefaultToolRegistry();

// Register custom tool
registry.register({
  definition: {
    name: 'read_file',
    description: 'Read content from a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
    awaitsExternalResponse: true,
  },
  executor: async (args, context) => {
    const content = await fs.readFile(args.path as string, 'utf-8');
    return { callId: context.callId, success: true, content };
  },
  category: 'common',
});

// Execute tool
const result = await registry.execute(
  'read_file',
  { path: '/foo' },
  {
    threadId: 'thread-1',
    callId: 'call-1',
  },
);
```

### formatToolListForContext()

Generates tool list text for LLM context, grouped by category:

```
[AVAILABLE TOOLS] (use invoke_tool to call)

Common Tools:
- read_file: Read content from a file
- search: Search the web

Agent Tools:
- code_review: Review code quality

Workflow Tools:
- submit_pr: Submit a pull request
```

## Execution Flow

All tools use event-driven architecture:

```
LLM wants to read a file
        │
        ▼
Calls invoke_tool(tool_name="read_file", arguments={path: "/foo"})
        │
        ▼
LLM_TOOL_CALL event dispatched
  type: LLM_TOOL_CALL
  toolName: "invoke_tool"
  arguments: { tool_name: "read_file", arguments: { path: "/foo" } }
        │
        ▼
AgentExecutor stops (awaitsExternalResponse=true)
        │
        ▼
External system (AgentService) handles:
  1. Identifies invoke_tool call
  2. Parses tool_name = "read_file"
  3. Finds tool in ToolRegistry and executes
  4. Injects TOOL_RESULT event
        │
        ▼
AgentExecutor continues LLM loop
```

## Integration with AgentExecutor

In `agent-runtime`, `AgentExecutorConfig` supports:

```typescript
interface AgentExecutorConfig {
  maxTurns?: number;
  timeout?: number;
  autoRun?: boolean;
  tools?: string[]; // Control tool names (backward compatible)
  customTools?: CustomToolConfig[]; // Custom external tools
  toolRegistry?: IToolRegistry; // Full registry (alternative)
}
```

### Example

```typescript
import { createDefaultToolRegistry } from '@team9/agent-framework';

// Method 1: Using customTools
const executor = new AgentExecutor(memoryManager, llmAdapter, {
  tools: ['wait_user_response', 'invoke_tool', 'task_complete'],
  customTools: [
    {
      definition: { name: 'read_file', ... },
      executor: readFileExecutor,
      category: 'common',
    },
  ],
});

// Method 2: Using toolRegistry directly
const registry = createDefaultToolRegistry();
registry.register({ ... });

const executor = new AgentExecutor(memoryManager, llmAdapter, {
  toolRegistry: registry,
});
```

## Key Functions

| Function                      | Description                           |
| ----------------------------- | ------------------------------------- |
| `createDefaultToolRegistry()` | Create registry with control tools    |
| `getControlTool(name)`        | Get control tool by name              |
| `isControlTool(name)`         | Check if tool is a control tool       |
| `controlTools`                | Array of all control tool definitions |

## Exports

From `@team9/agent-framework`:

```typescript
// Types
export type { ToolDefinition, ToolExecutor, ToolResult, ToolExecutionContext };
export type { ToolCategory, Tool, CustomToolConfig };
export type { IToolRegistry };

// Classes
export { ToolRegistry };

// Functions
export { createDefaultToolRegistry };
export { getControlTool, isControlTool };

// Constants
export { controlTools };

// Control tool definitions
export { waitUserResponseTool, outputTool, taskCompleteTool };
export { taskAbandonTool, waitParentTool, invokeToolTool };
```
