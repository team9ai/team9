# SubAgent Component

Stable component for managing sub-agent spawning and communication. Tracks active sub-agents and their status.

## Overview

The SubAgent component manages the lifecycle of child agents that are spawned to handle sub-tasks.

## Component Details

| Property | Value                         |
| -------- | ----------------------------- |
| ID       | `builtin:subagent`            |
| Name     | Sub-Agent Manager             |
| Type     | `stable` (cannot be disabled) |

## SubAgent Info Structure

```typescript
interface SubAgentInfo {
  id: string;
  type: string; // Sub-agent blueprint type
  task: string; // Task description
  status: 'spawning' | 'running' | 'completed' | 'failed';
  spawnedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
}
```

## Tracked Events

The component integrates with WorkingHistoryComponent which handles:

| Event Type             | Description                      |
| ---------------------- | -------------------------------- |
| `LLM_SUBAGENT_SPAWN`   | Agent spawns a sub-agent         |
| `LLM_SUBAGENT_MESSAGE` | Agent sends message to sub-agent |
| `SUBAGENT_RESULT`      | Sub-agent completed              |
| `SUBAGENT_ERROR`       | Sub-agent failed                 |

## Usage

### Blueprint Configuration

```typescript
const blueprint: Blueprint = {
  name: 'Orchestrator Agent',
  components: [{ component: SubAgentComponent }],
  subAgents: {
    researcher: {
      /* blueprint */
    },
    coder: {
      /* blueprint */
    },
  },
};
```

## Rendering

Active sub-agents are rendered in the system prompt:

```
<subagent_status>
Active Sub-Agents:
  ... [sa_123] researcher: Finding relevant documentation
  > [sa_456] coder: Implementing the feature
</subagent_status>
```

- `...` = spawning
- `>` = running
- Location: `system` prompt
- Order: 850 (after todos)

## Files

| File                     | Description               |
| ------------------------ | ------------------------- |
| `subagent.component.ts`  | `SubAgentComponent` class |
| `subagent.types.ts`      | `SubAgentInfo` type       |
| `subagent.operations.ts` | Chunk creation operations |
| `index.ts`               | Public exports            |

## Component Data

The component tracks sub-agents in its data store:

```typescript
context.getData<Map<string, SubAgentInfo>>('subagents');
```

## Exports

```typescript
export { SubAgentComponent } from './subagent.component';
export type { SubAgentInfo } from './subagent.types';
export {
  STATUS_CHUNK_KEY as SUBAGENT_STATUS_CHUNK_KEY,
  createSubAgentStatusChunk,
} from './subagent.operations';
```
