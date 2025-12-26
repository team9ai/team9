# PostgreSQL Storage

This directory contains the PostgreSQL implementation of the storage provider.

## File Structure

| File                  | Description                                   |
| --------------------- | --------------------------------------------- |
| `schema.ts`           | Database schema definitions using Drizzle ORM |
| `postgres.storage.ts` | PostgresStorageProvider implementation        |

## Database Schema

### memory_threads

Stores thread metadata.

| Column         | Type         | Description           |
| -------------- | ------------ | --------------------- |
| id             | VARCHAR(100) | Thread ID (PK)        |
| agent_id       | VARCHAR(100) | Associated agent ID   |
| metadata       | JSONB        | Thread metadata       |
| state_snapshot | JSONB        | Latest state snapshot |
| created_at     | TIMESTAMP    | Creation time         |
| updated_at     | TIMESTAMP    | Last update time      |

### memory_chunks

Stores individual memory chunks.

| Column             | Type         | Description           |
| ------------------ | ------------ | --------------------- |
| id                 | VARCHAR(100) | Chunk ID (PK)         |
| thread_id          | VARCHAR(100) | Parent thread ID (FK) |
| type               | VARCHAR(50)  | ChunkType             |
| content            | JSONB        | Chunk content         |
| retention_strategy | VARCHAR(50)  | Retention strategy    |
| metadata           | JSONB        | Chunk metadata        |
| created_at         | TIMESTAMP    | Creation time         |

### memory_events

Stores event history for replay.

| Column     | Type         | Description            |
| ---------- | ------------ | ---------------------- |
| id         | SERIAL       | Auto-increment ID (PK) |
| thread_id  | VARCHAR(100) | Thread ID (FK)         |
| event_id   | VARCHAR(100) | Event ID               |
| event_type | VARCHAR(50)  | EventType              |
| event_data | JSONB        | Full event data        |
| created_at | TIMESTAMP    | Creation time          |

## Usage

```typescript
import { PostgresStorageProvider } from './storage/postgres';

const storage = new PostgresStorageProvider(drizzleDb);
```

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Database schema changes require:

- Migration scripts
- Updating related queries
- Testing with actual database
