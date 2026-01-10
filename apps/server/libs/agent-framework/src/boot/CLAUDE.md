# boot/ - User-Friendly API Entry Point

The `boot/` module provides a simplified, user-friendly API for creating and managing agents. It hides internal implementation details like `AgentOrchestrator` and provides a clean interface for common operations.

## Files

| File              | Description                                                     |
| ----------------- | --------------------------------------------------------------- |
| `types.ts`        | Type definitions for `AgentFactoryConfig`, `CreateAgentOptions` |
| `Agent.ts`        | Agent instance wrapper class                                    |
| `AgentFactory.ts` | Factory for creating and managing agents                        |
| `index.ts`        | Public exports                                                  |

## Quick Start

```typescript
import {
  AgentFactory,
  Agent,
  InMemoryStorageProvider,
} from '@team9/agent-framework';

// 1. Create factory with configuration
const factory = new AgentFactory({
  storage: new InMemoryStorageProvider(),
  llmAdapter: myLLMAdapter,
  defaultLLMConfig: { model: 'gpt-4' },
  components: [MyComponent, AnotherComponent], // Register via config
  tools: [myTool], // Register via config
});

// 2. Create agent from blueprint
const agent = await factory.createAgent(blueprint);

// 3. Use agent
await agent.dispatch(someEvent);
const state = await agent.getState();

// 4. Restore existing agent
const restoredAgent = await factory.restoreAgent(threadId);
```

## AgentFactory

Factory class for creating and managing agent instances.

### Configuration

```typescript
interface AgentFactoryConfig {
  storage: StorageProvider; // Required: Storage provider
  llmAdapter: ILLMAdapter; // Required: LLM adapter
  defaultLLMConfig: LLMConfig; // Required: Default LLM config (for compaction)
  autoCompactEnabled?: boolean; // Optional: Enable auto-compaction (default: true)
  tokenThresholds?: Partial<TokenThresholds>; // Optional: Token thresholds
  defaultExecutionMode?: ExecutionMode; // Optional: 'auto' | 'stepping' (default: 'auto')
  components?: ComponentConstructor[]; // Optional: Components to register
  tools?: Tool[]; // Optional: Tools to register
}
```

### Methods

| Method                             | Description                         |
| ---------------------------------- | ----------------------------------- |
| `registerComponent(constructor)`   | Register a component constructor    |
| `registerTool(tool)`               | Register a tool                     |
| `createAgent(blueprint, options?)` | Create new agent from blueprint     |
| `restoreAgent(threadId)`           | Restore agent from persisted state  |
| `getAgent(threadId)`               | Get cached agent by thread ID       |
| `deleteAgent(threadId)`            | Delete agent and its persisted data |

### CreateAgentOptions

```typescript
interface CreateAgentOptions {
  llmConfigOverride?: Partial<LLMConfig>; // Override blueprint LLM config
  executionMode?: ExecutionMode; // Override execution mode
}
```

## Agent

Wrapper class for agent instances, providing simplified access to agent operations.

### Properties

| Property        | Type           | Description                                |
| --------------- | -------------- | ------------------------------------------ |
| `threadId`      | `string`       | Unique thread identifier                   |
| `blueprintName` | `string?`      | Blueprint name (if created from blueprint) |
| `tools`         | `Tool[]`       | Available tools                            |
| `components`    | `IComponent[]` | Component instances                        |

### Methods

#### Core Operations

| Method            | Description                              |
| ----------------- | ---------------------------------------- |
| `dispatch(event)` | Dispatch an event to the agent           |
| `step()`          | Execute single step (stepping mode only) |

#### State Queries

| Method        | Description              |
| ------------- | ------------------------ |
| `getState()`  | Get current memory state |
| `getThread()` | Get thread metadata      |

#### Execution Mode

| Method                   | Description                |
| ------------------------ | -------------------------- |
| `getExecutionMode()`     | Get current execution mode |
| `setExecutionMode(mode)` | Set execution mode         |

#### Observers

| Method                     | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `addObserver(observer)`    | Add memory observer, returns unsubscribe function |
| `removeObserver(observer)` | Remove memory observer                            |

#### Advanced

| Method                | Description                        |
| --------------------- | ---------------------------------- |
| `triggerCompaction()` | Manually trigger memory compaction |

#### Event Queue

| Method                    | Description                 |
| ------------------------- | --------------------------- |
| `getPendingEvents()`      | Get pending events in queue |
| `getPendingEventsCount()` | Get count of pending events |

#### Step Operations

| Method            | Description                   |
| ----------------- | ----------------------------- |
| `getSteps()`      | Get all steps for this thread |
| `getStep(stepId)` | Get a specific step by ID     |

#### State History

| Method              | Description                       |
| ------------------- | --------------------------------- |
| `getStateHistory()` | Get state history for this thread |

## Example Usage

### Basic Agent Creation

```typescript
const factory = new AgentFactory({
  storage: new InMemoryStorageProvider(),
  llmAdapter: new AnthropicAdapter({ apiKey: '...' }),
  defaultLLMConfig: { model: 'claude-3-5-sonnet-20241022' },
});

// Register components
factory.registerComponent(SystemPromptComponent);
factory.registerComponent(WorkingHistoryComponent);

const blueprint: Blueprint = {
  name: 'my-agent',
  llmConfig: { model: 'claude-3-5-sonnet-20241022' },
  components: [
    { componentKey: 'system-prompt', config: { prompt: 'You are helpful.' } },
    { componentKey: 'working-history' },
  ],
  tools: ['task-complete', 'output'],
};

const agent = await factory.createAgent(blueprint);
```

### Event Dispatch

```typescript
// Dispatch user message
await agent.dispatch({
  type: EventType.USER_MESSAGE,
  content: 'Hello!',
  timestamp: Date.now(),
});

// Check state
const state = await agent.getState();
console.log('Chunks:', state?.chunkIds.length);
```

### Stepping Mode

```typescript
const agent = await factory.createAgent(blueprint, {
  executionMode: 'stepping',
});

// Dispatch event (queued)
await agent.dispatch(userMessageEvent);

// Process one step at a time
const result = await agent.step();
console.log('Event processed:', result.eventProcessed);
console.log('Needs response:', result.needsResponse);
```

### Restore Agent

```typescript
// Save threadId somewhere (e.g., database)
const threadId = agent.threadId;

// Later, restore the agent
const restoredAgent = await factory.restoreAgent(threadId);
await restoredAgent.dispatch(newEvent);
```

## Internal Architecture

```
AgentFactory
├── ComponentRegistry (shared)
├── ReducerRegistry (default reducers)
├── AgentOrchestrator (internal)
├── BlueprintLoader
└── Agent cache (Map<threadId, Agent>)

Agent
├── threadId
├── orchestrator reference (internal)
├── tools[]
└── components[]
```

The `boot/` module wraps the internal `AgentOrchestrator` to provide:

- Simplified configuration via `AgentFactoryConfig`
- Agent instance caching
- Clean separation between factory (registration) and agent (operations)
- Type-safe API with minimal exposed internals
