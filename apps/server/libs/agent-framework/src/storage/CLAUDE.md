# Memory Storage

This directory contains storage provider implementations for persisting Memory state.

## File Structure

| File                | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `storage.types.ts`  | Storage provider interface: IStorageProvider                                       |
| `memory.storage.ts` | In-memory storage implementation (for testing/development)                         |
| `postgres/`         | PostgreSQL storage implementation (see [postgres/CLAUDE.md](./postgres/CLAUDE.md)) |

## IStorageProvider Interface

```typescript
interface IStorageProvider {
  // Thread operations
  getThread(threadId: string): Promise<Thread | null>;
  saveThread(thread: Thread): Promise<void>;
  deleteThread(threadId: string): Promise<void>;

  // State operations
  getState(threadId: string): Promise<MemoryState | null>;
  saveState(threadId: string, state: MemoryState): Promise<void>;

  // Event history (for replay)
  appendEvent(threadId: string, event: AgentEvent): Promise<void>;
  getEvents(threadId: string, fromIndex?: number): Promise<AgentEvent[]>;
}
```

## Implementations

### MemoryStorageProvider

In-memory storage, useful for:

- Unit testing
- Development/prototyping
- Short-lived sessions

### PostgresStorageProvider

PostgreSQL-backed storage for:

- Production use
- Persistent conversations
- Event sourcing / replay

## Usage

```typescript
import { MemoryStorageProvider } from './storage';
import { PostgresStorageProvider } from './storage/postgres';

// In-memory (testing)
const memoryStorage = new MemoryStorageProvider();

// PostgreSQL (production)
const pgStorage = new PostgresStorageProvider(drizzleDb);
```

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Storage changes may affect:

- ThreadManager
- MemoryManager
- Event replay logic
