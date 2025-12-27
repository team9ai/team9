# Agent Debugger

Frontend application for debugging AI agents. Built with React, TanStack Router, and Zustand.

## Package Info

- **Name**: `@team9/debugger`
- **Version**: 0.0.1
- **Framework**: React + Vite
- **Router**: TanStack Router
- **State Management**: Zustand

## Directory Structure

```
debugger/
├── src/
│   ├── main.tsx              # App entry point
│   ├── types/
│   │   └── index.ts          # Type definitions (mirrors agent-framework)
│   ├── routes/               # TanStack Router pages
│   │   ├── __root.tsx        # Root layout
│   │   ├── index.tsx         # Agent list page
│   │   ├── agent/$agentId.tsx # Agent debug view
│   │   ├── blueprints/       # Blueprint management
│   │   └── batch-test/       # Batch testing
│   ├── components/
│   │   ├── agent/            # Agent controls
│   │   │   └── AgentControls.tsx
│   │   ├── blueprint/        # Blueprint editors
│   │   ├── state/            # State viewer
│   │   └── tree/             # Execution tree
│   ├── stores/
│   │   └── useDebugStore.ts  # Zustand store for debug state
│   └── services/
│       ├── api/              # REST API client
│       │   ├── client.ts     # Base API client
│       │   ├── agent.api.ts  # Agent API methods
│       │   └── blueprint.api.ts
│       └── sse/              # Server-Sent Events
│           └── agent-events.ts
└── package.json
```

## Core Types

The debugger maintains its own type definitions that mirror `@team9/agent-framework`:

### ExecutionMode

```typescript
type ExecutionMode = "auto" | "stepping";
```

### AgentStatus

```typescript
type AgentStatus =
  | "processing" // Actively generating content
  | "waiting_internal" // Waiting for sub-agent/tool
  | "awaiting_input" // Waiting for external input
  | "paused" // Paused in stepping mode
  | "completed" // Task completed
  | "error"; // Encountered an error
```

### EventDispatchStrategy

```typescript
type EventDispatchStrategy = "queue" | "interrupt" | "terminate" | "silent";
```

## State Management

### useDebugStore (Zustand)

Main store for debug session state:

```typescript
interface DebugStore {
  // Current agent
  currentAgentId: string | null;
  currentAgent: AgentInstance | null;

  // States
  stateHistory: StateSummary[];
  currentState: MemoryState | null;
  selectedStateId: string | null;
  selectedState: MemoryState | null;

  // Execution mode
  executionModeStatus: ExecutionModeStatus | null;
  isStepping: boolean;
  lastStepResult: StepResult | null;

  // Actions
  setCurrentAgent: (agentId: string) => Promise<void>;
  setExecutionMode: (mode: ExecutionMode) => Promise<void>;
  step: () => Promise<StepResult | null>;
  injectEvent: (eventType: string, payload?: unknown) => Promise<void>;
  forkFromState: (stateId: string) => Promise<AgentInstance>;
}
```

## API Integration

### Agent API

- `agentApi.create(request)` - Create agent
- `agentApi.list()` - List agents
- `agentApi.get(id)` - Get agent
- `agentApi.delete(id)` - Delete agent
- `agentApi.getExecutionModeStatus(id)` - Get mode status
- `agentApi.setExecutionMode(id, mode)` - Set mode
- `agentApi.step(id)` - Execute single step
- `agentApi.injectEvent(id, request)` - Inject event
- `agentApi.fork(id, request)` - Fork from state

### SSE Events

Subscribed event types:

- `state:change` - State updated
- `agent:status_changed` - Status changed
- `agent:mode_changed` - Execution mode changed
- `agent:stepped` - Step executed
- `subagent:spawn` - Sub-agent spawned
- `subagent:result` - Sub-agent returned

## Running

```bash
# Development
pnpm dev

# Build
pnpm build
```
