# Task Tracker Microservice

A REST microservice for tracking long-running task execution, progress updates, and worker assignment.

## Overview

Task Tracker provides:

- Task registration and lifecycle management
- Real-time progress tracking via SSE (Server-Sent Events)
- Worker-based task claiming and release
- Automatic timeout detection
- Task retry with history preservation

## Architecture

```
task-tracker/
├── src/
│   ├── main.ts              # Application bootstrap (port 3002)
│   ├── app.module.ts        # Root module with DatabaseModule, RedisModule
│   ├── load-env.ts          # Environment variable loading
│   ├── task/                # Core task management
│   │   ├── task.module.ts
│   │   ├── task.service.ts  # Business logic for all 9 APIs
│   │   ├── task.controller.ts
│   │   └── dto/             # Request/Response DTOs
│   ├── sse/                 # SSE broadcasting service
│   │   └── sse.service.ts
│   └── shared/
│       ├── constants/       # Redis key generators
│       └── types/           # Progress and SSE types
```

## Database Schema

Table: `tracker_tasks` (defined in `libs/database/src/schemas/tracker/tasks.ts`)

Key fields:

- `id`: Task identifier (CUID or custom)
- `taskType`: Worker filter key
- `status`: pending | in_progress | completed | failed | timeout
- `metadata`: Descriptive info about the task (JSONB)
- `params`: Execution parameters passed to worker (JSONB)
- `result`/`error`: Final output (JSONB)
- `progressHistory`: Persisted progress array (JSONB)
- `workerId`: Currently assigned worker
- `timeoutAt`: Automatic timeout timestamp
- `originalTaskId`: For retry tracking

## Redis Keys

All keys use namespace prefix: `team9:tracker:`

- `team9:tracker:progress:{taskId}` - Progress history array (list)
- `team9:tracker:seq:{taskId}` - Sequence counter for progress updates

## API Endpoints

All endpoints are prefixed with `/api/v1/tasks`

### 1. Register Task

```
POST /api/v1/tasks
Body: { taskId?, taskType, metadata?, params?, timeoutSeconds? }
Response: { taskId, status, createdAt, timeoutAt }
```

### 2. Update Task Status

```
POST /api/v1/tasks/:taskId/start    # Set to in_progress
POST /api/v1/tasks/:taskId/complete # Finish with result
POST /api/v1/tasks/:taskId/fail     # Finish with error
POST /api/v1/tasks/:taskId/timeout  # Manual timeout
```

### 3. Get Task Status

```
GET /api/v1/tasks/:taskId
Response: Task object with all fields
```

### 4. Update Progress

```
POST /api/v1/tasks/:taskId/progress
Body: { progress: { ...data } }
Response: { taskId, seqId, timestamp }
```

### 5. Track Progress (SSE)

```
GET /api/v1/tasks/:taskId/track?afterSeqId=5&ignoreHistory=true
Query params:
  - afterSeqId: Only send progress entries with seqId > this value
  - ignoreHistory: If 'true', skip all history (only new updates for active tasks)

Response: SSE stream with events:
  - progress: { event: 'progress', data: { seqId, ...progressData }, taskId, timestamp }
  - status_change: { event: 'status_change', data: { status, result?, error? }, taskId, timestamp }

Behavior:
  - Streams progress entries individually (not batched as history)
  - For completed/failed/timeout: streams all progress then status_change then closes
  - For pending/in_progress: streams history (filtered) then live updates
```

### 6. Process Timeouts

```
POST /api/v1/tasks/timeouts/process
Response: { processedCount }
```

### 7. Claim Task

```
POST /api/v1/tasks/claim
Body: { taskTypes: string[], workerId }
Response: Task | null
```

### 8. Release Task

```
POST /api/v1/tasks/:taskId/release
Body: { workerId }
Response: { taskId, status, message }
```

### 9. Retry Task

```
POST /api/v1/tasks/:taskId/retry
Response: { newTaskId, originalTaskId, status, retryCount }
```

## Task Lifecycle

```
┌─────────┐     claim/start     ┌─────────────┐
│ pending │ ──────────────────► │ in_progress │
└─────────┘                     └─────────────┘
     ▲                                │
     │ release                        │
     │                    ┌───────────┼───────────┐
     │                    ▼           ▼           ▼
     │              ┌──────────┐ ┌────────┐ ┌─────────┐
     └───────────── │ completed│ │ failed │ │ timeout │
                    └──────────┘ └────────┘ └─────────┘
                                      │
                                      │ retry
                                      ▼
                                ┌─────────┐
                                │ pending │ (new task)
                                └─────────┘
```

## Progress Tracking Flow

1. Worker updates progress: `POST /tasks/:id/progress`
2. Service increments seqId in Redis
3. Progress entry stored in Redis list
4. SSE subscribers receive real-time update
5. On task completion: Redis data persisted to PostgreSQL, Redis cleaned up

## Running the Service

```bash
# Development
pnpm --filter @team9/task-tracker start:dev

# Production
pnpm --filter @team9/task-tracker build
pnpm --filter @team9/task-tracker start:prod
```

Default port: `3002` (configurable via `TASK_TRACKER_PORT` env var)

## Dependencies

- `@team9/database`: PostgreSQL via Drizzle ORM
- `@team9/redis`: Redis for progress caching
- `@team9/shared`: Shared env configuration
- `@paralleldrive/cuid2`: ID generation
