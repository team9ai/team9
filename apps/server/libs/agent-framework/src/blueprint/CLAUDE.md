# Blueprint

This directory contains the blueprint system for defining and creating agents.

## File Structure

| File                  | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `blueprint.types.ts`  | Type definitions for Blueprint and related types     |
| `blueprint-loader.ts` | BlueprintLoader for creating threads from blueprints |
| `index.ts`            | Public exports                                       |

## Blueprint Interface

A Blueprint defines the configuration for creating an agent:

```typescript
interface Blueprint {
  id?: string; // Optional unique identifier
  name: string; // Agent name (required)
  description?: string; // Agent description
  initialChunks: BlueprintChunk[]; // Initial memory chunks
  llmConfig: LLMConfig; // LLM configuration (required)
  tools?: string[]; // Available tools
  autoCompactThreshold?: number; // Compaction threshold
  executionMode?: ExecutionMode; // 'auto' | 'stepping'
  subAgents?: Record<string, Blueprint>; // Nested sub-agent blueprints
}
```

## ExecutionMode

Blueprints can specify an initial execution mode:

| Mode       | Description                            | Use Case                    |
| ---------- | -------------------------------------- | --------------------------- |
| `auto`     | Events processed immediately (default) | Normal operation            |
| `stepping` | Events queued until step() called      | Debugging, batch generation |

```typescript
const blueprint: Blueprint = {
  name: 'SafeAgent',
  llmConfig: { model: 'claude-3-opus' },
  initialChunks: [...],
  executionMode: 'stepping', // Start in stepping mode for safety
};
```

## BlueprintLoader

Creates agent threads from blueprint definitions.

### Usage

```typescript
import { BlueprintLoader } from '@team9/agent-framework';

const loader = new BlueprintLoader(memoryManager);

// Validate a blueprint
const validation = loader.validate(blueprint);
if (!validation.valid) {
  console.error(validation.errors);
}

// Load with overrides
const { blueprint: loaded, warnings } = loader.load(blueprint, {
  llmConfigOverride: { model: 'claude-3-sonnet' },
  autoCompactThresholdOverride: 30,
});

// Create thread from blueprint
const result = await loader.createThreadFromBlueprint(blueprint);
// result.thread, result.initialState

// Parse from JSON
const bp = BlueprintLoader.parseFromJSON(jsonString);

// Serialize to JSON
const json = BlueprintLoader.toJSON(blueprint, true);
```

## BlueprintChunk

Simplified chunk definition for JSON serialization:

```typescript
interface BlueprintChunk {
  type: string; // ChunkType (SYSTEM, AGENT, etc.)
  subType?: string; // WorkingFlowSubType (for WORKING_FLOW)
  content: ChunkContent; // Chunk content
  retentionStrategy?: string; // ChunkRetentionStrategy
  mutable?: boolean; // Default: false
  priority?: number; // Default: 0
}
```

## Example Blueprint

```typescript
const agentBlueprint: Blueprint = {
  id: 'coding-assistant-v1',
  name: 'Coding Assistant',
  description: 'An AI assistant for code review and generation',
  llmConfig: {
    model: 'claude-3-opus',
    maxTokens: 4096,
  },
  tools: ['read_file', 'write_file', 'run_command'],
  autoCompactThreshold: 25,
  executionMode: 'auto',
  initialChunks: [
    {
      type: 'SYSTEM',
      content: {
        type: 'text',
        text: 'You are a helpful coding assistant...',
      },
      retentionStrategy: 'CRITICAL',
    },
  ],
  subAgents: {
    testRunner: {
      name: 'Test Runner',
      llmConfig: { model: 'claude-3-haiku' },
      initialChunks: [...],
    },
  },
};
```

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Blueprint changes may affect:

- Agent creation flow
- Configuration validation
- Integration with MemoryManager
