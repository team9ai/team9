# Seedance Video Generation Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Bytedance Seedance 2.0 video generation as a billed capability in capability-hub; expose it to agent-pi via existing discovery; let users invoke it from team9 dashboard via a chip that injects a prompt template; render results inline. Extract a generic BullMQ-backed long-task module along the way and migrate `deep-research` onto it.

**Architecture:** New `tasks/` module in capability-hub (BullMQ + Postgres + Redis pub/sub for cross-instance SSE) becomes the universal long-task primitive. New `seedance/` module registers `seedance_generate_video` capability and a TaskRunner that polls OpenRouter. agent-pi's existing `Team9CapabilityHubComponent` is extended with an async-task-executor that polls task state and surfaces progress via the existing `onUpdate` event. team9 reuses its attachment + presigned-S3 plumbing — no new message type — and adds a small `<video>` renderer + dashboard chip.

**Tech Stack:**

- capability-hub: NestJS 11, Drizzle ORM (0.45), PostgreSQL, **NEW: Redis + BullMQ + ioredis**, Jest 30
- agent-pi: TypeScript / Vitest, monorepo via turborepo
- team9 client: React 19, TanStack Router/Query, Tailwind, Lucide, Vitest + Playwright
- team9 server: NestJS, MinIO/S3 (already wired)

**Spec reference:** `docs/superpowers/specs/2026-04-27-seedance-integration-design.md`

**Repo locations (use these as `cd` targets):**

- `CH = /Users/jiangtao/Desktop/shenjingyuan/capability-hub`
- `AP = /Users/jiangtao/Desktop/shenjingyuan/agent-pi`
- `T9 = /Users/jiangtao/Desktop/shenjingyuan/team9/.worktrees/seedance-integrate`

**Conventions:**

- Each phase ends with a commit. Multiple atomic commits within a phase are encouraged.
- Commit messages: English only, conventional-commits style; no `Co-Authored-By` line.
- Tests: capability-hub uses `*.spec.ts` with Jest & NestJS Test module; agent-pi uses `*.test.ts` with Vitest; team9 client uses `*.test.tsx` with Vitest + jsdom.
- All code comments in English.

---

## File Structure

### capability-hub (`$CH`) — new files

| Path                                             | Responsibility                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `src/tasks/tasks.module.ts`                      | Wires BullModule, schema, controller, worker, registry, recovery     |
| `src/tasks/tasks.service.ts`                     | `submit / get / list / cancel / stream` consumer-facing API          |
| `src/tasks/tasks.controller.ts`                  | `GET /api/tasks/:id`, `GET /api/tasks`, `POST /api/tasks/:id/cancel` |
| `src/tasks/task-stream.controller.ts`            | `GET /api/tasks/:id/stream` (SSE)                                    |
| `src/tasks/task-runner.registry.ts`              | Handler lookup keyed by `taskType`                                   |
| `src/tasks/task-runner.worker.ts`                | BullMQ Worker; loads handler, executes, persists                     |
| `src/tasks/task-event.bus.ts`                    | Redis pub/sub for cross-instance SSE delivery                        |
| `src/tasks/ring-buffer.ts`                       | LIFTED from `src/deep-research/ring-buffer.ts`                       |
| `src/tasks/startup-recovery.service.ts`          | Marks orphan `running` tasks → `failed` on boot                      |
| `src/tasks/dto/submit-task.dto.ts`               | Input DTO                                                            |
| `src/tasks/dto/list-tasks.dto.ts`                | Query DTO                                                            |
| `src/tasks/types.ts`                             | `Task`, `TaskRunner`, `TaskEvent`, `Owner` types                     |
| `src/database/schema/tasks.schema.ts`            | New `tasks` table                                                    |
| `src/seedance/seedance.module.ts`                | Registers capability + handler + cost strategy on init               |
| `src/seedance/seedance.service.ts`               | `onModuleInit` registration logic                                    |
| `src/seedance/seedance-task.handler.ts`          | TaskRunner: submit → poll OpenRouter → return                        |
| `src/seedance/seedance-cost.strategy.ts`         | Cost computation per `(model, durationSec)`                          |
| `src/seedance/openrouter.client.ts`              | Thin OpenRouter Seedance API wrapper                                 |
| `src/seedance/dto/seedance-input.dto.ts`         | Input validation                                                     |
| `src/scripts/migrate-research-tasks-to-tasks.ts` | One-shot data backfill script                                        |

### capability-hub (`$CH`) — modified files

| Path                                                                  | Change                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------- |
| `package.json`                                                        | Add `bullmq`, `@nestjs/bullmq`, `ioredis`                |
| `docker-compose.yml`                                                  | Add Redis service                                        |
| `.env.example`                                                        | Add `REDIS_URL`                                          |
| `src/config/config.schema.ts`                                         | Validate `REDIS_URL`                                     |
| `src/app.module.ts`                                                   | Import `TasksModule`, `SeedanceModule`                   |
| `src/proxy/proxy.controller.ts` (or wherever `/api/invoke/:id` lives) | Auto-redirect async caps to `TaskService.submit`         |
| `src/database/schema/index.ts`                                        | Export `tasks` schema                                    |
| `src/deep-research/deep-research.module.ts`                           | Drop bespoke services, depend on `TasksModule`           |
| `src/deep-research/deep-research.service.ts`                          | Read/write via `TasksService` (keep public URL contract) |
| `src/deep-research/task-runner.service.ts`                            | Refactored into `DeepResearchTaskHandler` (TaskRunner)   |
| `src/deep-research/sse-relay.service.ts`                              | Removed (subsumed by `task-stream.controller.ts`)        |
| `src/deep-research/startup-recovery.service.ts`                       | Removed (subsumed by generic)                            |

### agent-pi (`$AP`) — new files

| Path                                                                            | Responsibility                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------- |
| `packages/claw-hive/src/components/team9-capability-hub/async-task-executor.ts` | Polling executor for `metadata.async` capabilities |

### agent-pi (`$AP`) — modified files

| Path                                                                  | Change                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/claw-hive/src/components/team9-capability-hub/client.ts`    | Add `getTask`, `cancelTask` methods; `invokeCapability` accepts 202 `{taskId}` shape |
| `packages/claw-hive/src/components/team9-capability-hub/component.ts` | Choose executor by `capability.metadata.async`                                       |
| `packages/claw-hive-types/src/components.ts`                          | Extend `Team9CapabilityHubComponentConfig` with async options                        |
| `packages/claw-hive/src/components/team9/tools.ts`                    | Add `SendVideo` tool (mirror of `SendImage`)                                         |

### team9 (`$T9`) — new files

| Path                                                     | Responsibility              |
| -------------------------------------------------------- | --------------------------- |
| `apps/client/src/components/channel/VideoAttachment.tsx` | `<video controls>` renderer |

### team9 (`$T9`) — modified files

| Path                                                             | Change                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/client/src/components/channel/MessageAttachments.tsx`      | Dispatch `mimeType.startsWith("video/")` → `VideoAttachment`               |
| `apps/client/src/components/layout/contents/HomeMainContent.tsx` | Add Video chip to `DASHBOARD_ACTION_CHIPS`, `insertVideoTemplate()` helper |
| `apps/client/src/i18n/locales/zh-CN/navigation.json`             | Add `dashboardActionVideoGeneration`, `dashboardVideoGenerationTemplate`   |
| `apps/client/src/i18n/locales/en-US/navigation.json`             | English equivalents                                                        |

---

## Phase 1 — capability-hub: Redis + BullMQ infrastructure

### Task 1.1: Add Redis to docker-compose

**Files:**

- Modify: `$CH/docker-compose.yml`
- Modify: `$CH/.env.example`

- [ ] **Step 1: Add Redis service to docker-compose**

In `docker-compose.yml`, after the `minio` service:

```yaml
redis:
  image: redis:7.4-alpine
  container_name: capability_redis_server
  restart: always
  ports:
    - "${REDIS_PORT:-6379}:6379"
  volumes:
    - redis_data:/data
  command: ["redis-server", "--appendonly", "yes"]
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
```

Append to `volumes:` section:

```yaml
redis_data:
  driver: local
```

- [ ] **Step 2: Add Redis env to .env.example**

Append to `$CH/.env.example`:

```
# Redis (BullMQ backend for tasks module)
REDIS_URL=redis://localhost:6379
REDIS_PORT=6379
```

- [ ] **Step 3: Smoke-test Redis comes up**

```bash
cd $CH
docker compose up -d redis
docker compose exec redis redis-cli ping
# Expected: PONG
```

### Task 1.2: Add BullMQ + ioredis dependencies

**Files:**

- Modify: `$CH/package.json`

- [ ] **Step 1: Install deps**

```bash
cd $CH
pnpm add bullmq @nestjs/bullmq ioredis
```

Expected: `package.json` shows `"bullmq": "^5.x"`, `"@nestjs/bullmq": "^11.x"`, `"ioredis": "^5.x"`.

- [ ] **Step 2: Verify install + typecheck still passes**

```bash
cd $CH
pnpm typecheck
```

Expected: 0 errors.

### Task 1.3: Add REDIS_URL to config schema

**Files:**

- Modify: `$CH/src/config/config.schema.ts`
- Modify: `$CH/src/config/config.schema.spec.ts`

- [ ] **Step 1: Read existing schema to learn the validation library**

```bash
cd $CH && head -40 src/config/config.schema.ts
```

- [ ] **Step 2: Write failing test**

Add to `config.schema.spec.ts`:

```ts
describe("REDIS_URL", () => {
  it("rejects missing REDIS_URL", () => {
    const result = configSchema.safeParse({
      ...validBaseEnv,
      REDIS_URL: undefined,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid redis url", () => {
    const result = configSchema.safeParse({
      ...validBaseEnv,
      REDIS_URL: "redis://localhost:6379",
    });
    expect(result.success).toBe(true);
  });
});
```

(Use the project's existing `validBaseEnv` fixture; if absent, build a minimal env object covering currently-required fields.)

- [ ] **Step 3: Run test, verify FAIL**

```bash
cd $CH && pnpm test -- src/config/config.schema.spec.ts
```

Expected: both new cases FAIL.

- [ ] **Step 4: Add `REDIS_URL` to the schema**

In `src/config/config.schema.ts`, add to the schema object:

```ts
REDIS_URL: z.string().url().startsWith('redis://').or(z.string().url().startsWith('rediss://')),
```

- [ ] **Step 5: Run test, verify PASS**

```bash
cd $CH && pnpm test -- src/config/config.schema.spec.ts
```

Expected: PASS.

### Task 1.4: Wire BullModule globally

**Files:**

- Create: `$CH/src/tasks/tasks.module.ts` (placeholder, expanded in Phase 2)
- Modify: `$CH/src/app.module.ts`

- [ ] **Step 1: Create minimal `tasks.module.ts`**

```ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>("REDIS_URL") },
      }),
    }),
    BullModule.registerQueue({ name: "tasks" }),
  ],
  exports: [BullModule],
})
export class TasksModule {}
```

- [ ] **Step 2: Import TasksModule into app.module**

Add to `$CH/src/app.module.ts` `imports: []` array:

```ts
TasksModule,
```

Plus the `import { TasksModule } from './tasks/tasks.module';` line.

- [ ] **Step 3: Boot smoke-test**

```bash
cd $CH
pnpm dev   # in another terminal
# wait for "Nest application successfully started"
curl -fsS http://localhost:${PORT:-3001}/health 2>/dev/null || echo "(no /health endpoint — boot completion is the signal)"
```

Expected: app boots without "ECONNREFUSED redis" in logs.

### Task 1.5: Commit Phase 1

- [ ] **Commit**

```bash
cd $CH
git add -A
git commit -m "feat(infra): add Redis + BullMQ wiring for upcoming tasks module"
```

---

## Phase 2 — capability-hub: TasksModule core

### Task 2.1: `tasks` table schema

**Files:**

- Create: `$CH/src/database/schema/tasks.schema.ts`
- Modify: `$CH/src/database/schema/index.ts`

- [ ] **Step 1: Write the schema file**

Copy verbatim from spec § 11.1. File `tasks.schema.ts`:

```ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  pgEnum,
  AnyPgColumn,
} from "drizzle-orm/pg-core";
import { desc } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { capabilities } from "./capabilities.schema";

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    taskType: varchar("task_type", { length: 64 }).notNull(),
    capabilityId: uuid("capability_id").references(() => capabilities.id, {
      onDelete: "set null",
    }),
    ownerUserId: varchar("owner_user_id", { length: 255 }).notNull(),
    ownerBotId: varchar("owner_bot_id", { length: 255 }).notNull(),
    ownerTenantId: varchar("owner_tenant_id", { length: 255 }).notNull(),
    parentTaskId: uuid("parent_task_id").references(
      (): AnyPgColumn => tasks.id,
      { onDelete: "set null" },
    ),
    interactionId: text("interaction_id").unique(),
    status: taskStatusEnum("status").notNull().default("pending"),
    input: jsonb("input").notNull(),
    result: jsonb("result"),
    resultMeta: jsonb("result_meta"),
    toolsConfig: jsonb("tools_config").notNull().default([]),
    storeRefs: text("store_refs").array().notNull().default([]),
    error: jsonb("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tasks_type_status_idx").on(t.taskType, t.status),
    index("tasks_tenant_created_idx").on(t.ownerTenantId, desc(t.createdAt)),
    index("tasks_user_created_idx").on(t.ownerUserId, desc(t.createdAt)),
    index("tasks_parent_idx").on(t.parentTaskId),
  ],
);
```

- [ ] **Step 2: Export from schema index**

Append to `$CH/src/database/schema/index.ts`:

```ts
export * from "./tasks.schema";
```

- [ ] **Step 3: Generate migration**

```bash
cd $CH && pnpm db:generate
```

Expected: a new SQL file appears under `src/database/migrations/` creating `task_status` enum + `tasks` table + 4 indexes.

- [ ] **Step 4: Apply migration to local DB**

```bash
cd $CH && pnpm db:migrate
```

Expected: migration applied. Verify with `psql $DATABASE_URL -c "\d tasks"`.

- [ ] **Step 5: Commit**

```bash
cd $CH && git add -A && git commit -m "feat(db): add generic tasks table with status enum + indexes"
```

### Task 2.2: Core types

**Files:**

- Create: `$CH/src/tasks/types.ts`

- [ ] **Step 1: Define types**

```ts
export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Owner {
  userId: string;
  botId: string;
  tenantId: string;
}

export interface TaskSnapshot<TInput = unknown, TResult = unknown> {
  id: string;
  taskType: string;
  capabilityId: string | null;
  status: TaskStatus;
  input: TInput;
  result: TResult | null;
  error: { code: string; message: string; details?: unknown } | null;
  owner: Owner;
  parentTaskId: string | null;
  interactionId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskEvent {
  seq: number;
  event?:
    | "started"
    | "progress"
    | "completed"
    | "failed"
    | "cancelled"
    | "log"
    | string;
  data: unknown;
}

export interface TaskRunnerContext<TInput = unknown> {
  taskId: string;
  input: TInput;
  emit: (event: { event?: string; data: unknown }) => Promise<void>;
  signal: AbortSignal;
  owner: Owner;
}

export interface TaskRunner<TInput = unknown, TResult = unknown> {
  taskType: string;
  run(ctx: TaskRunnerContext<TInput>): Promise<TResult>;
}

export class TaskError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly retriable: boolean = false,
  ) {
    super(message);
  }
}
```

### Task 2.3: TaskRunnerRegistry

**Files:**

- Create: `$CH/src/tasks/task-runner.registry.ts`
- Create: `$CH/src/tasks/task-runner.registry.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { TaskRunnerRegistry } from "./task-runner.registry";
import type { TaskRunner } from "./types";

const fake: TaskRunner = {
  taskType: "fake.echo",
  async run() {
    return {};
  },
};

describe("TaskRunnerRegistry", () => {
  it("registers and resolves by taskType", () => {
    const r = new TaskRunnerRegistry();
    r.register(fake);
    expect(r.get("fake.echo")).toBe(fake);
  });

  it("throws on duplicate registration", () => {
    const r = new TaskRunnerRegistry();
    r.register(fake);
    expect(() => r.register(fake)).toThrow(/already registered/i);
  });

  it("returns null for unknown taskType", () => {
    expect(new TaskRunnerRegistry().get("unknown")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL** (`pnpm test -- task-runner.registry.spec`). Expected: missing module.

- [ ] **Step 3: Implement**

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { TaskRunner } from "./types";

@Injectable()
export class TaskRunnerRegistry {
  private readonly log = new Logger(TaskRunnerRegistry.name);
  private readonly handlers = new Map<string, TaskRunner>();

  register(runner: TaskRunner): void {
    if (this.handlers.has(runner.taskType)) {
      throw new Error(`TaskRunner for "${runner.taskType}" already registered`);
    }
    this.handlers.set(runner.taskType, runner);
    this.log.log(`registered runner: ${runner.taskType}`);
  }

  get(taskType: string): TaskRunner | null {
    return this.handlers.get(taskType) ?? null;
  }

  list(): string[] {
    return [...this.handlers.keys()];
  }
}
```

- [ ] **Step 4: Verify PASS**.

### Task 2.4: TaskEventBus (Redis pub/sub)

**Files:**

- Create: `$CH/src/tasks/task-event.bus.ts`
- Create: `$CH/src/tasks/task-event.bus.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import Redis from "ioredis";
import { TaskEventBus } from "./task-event.bus";

describe("TaskEventBus", () => {
  let pub: Redis, sub: Redis, bus: TaskEventBus;
  beforeEach(() => {
    pub = new Redis(process.env.REDIS_URL!);
    sub = new Redis(process.env.REDIS_URL!);
    bus = new TaskEventBus(pub, sub);
  });
  afterEach(async () => {
    await pub.quit();
    await sub.quit();
  });

  it("round-trips an event from publish to subscriber", async () => {
    const taskId = `t-${Date.now()}`;
    const received: unknown[] = [];
    const stop = await bus.subscribe(taskId, (ev) => {
      received.push(ev);
    });
    await bus.publish(taskId, {
      seq: 1,
      event: "started",
      data: { hello: "world" },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toEqual([
      { seq: 1, event: "started", data: { hello: "world" } },
    ]);
    await stop();
  });

  it("persists events into a stream for replay", async () => {
    const taskId = `t-${Date.now()}`;
    await bus.publish(taskId, { seq: 1, event: "progress", data: { pct: 10 } });
    await bus.publish(taskId, { seq: 2, event: "progress", data: { pct: 20 } });
    const replayed = await bus.replay(taskId, "0");
    expect(replayed.map((e) => e.seq)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: FAIL** (no module).

- [ ] **Step 3: Implement**

```ts
import { Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import type { TaskEvent } from "./types";

const STREAM_TTL_SEC = 86400; // 24h

@Injectable()
export class TaskEventBus {
  private readonly log = new Logger(TaskEventBus.name);

  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
  ) {}

  private channel(taskId: string): string {
    return `task-events:${taskId}`;
  }
  private streamKey(taskId: string): string {
    return `task-stream:${taskId}`;
  }

  async publish(taskId: string, event: TaskEvent): Promise<void> {
    const payload = JSON.stringify(event);
    await this.pub.publish(this.channel(taskId), payload);
    const sk = this.streamKey(taskId);
    await this.pub.xadd(sk, "*", "data", payload);
    await this.pub.expire(sk, STREAM_TTL_SEC);
  }

  async subscribe(
    taskId: string,
    handler: (ev: TaskEvent) => void,
  ): Promise<() => Promise<void>> {
    const channel = this.channel(taskId);
    await this.sub.subscribe(channel);
    const onMessage = (chan: string, msg: string) => {
      if (chan !== channel) return;
      try {
        handler(JSON.parse(msg) as TaskEvent);
      } catch (e) {
        this.log.warn(`bad event payload: ${e}`);
      }
    };
    this.sub.on("message", onMessage);
    return async () => {
      this.sub.off("message", onMessage);
      await this.sub.unsubscribe(channel);
    };
  }

  async replay(taskId: string, fromId: string): Promise<TaskEvent[]> {
    const entries = (await this.pub.xrange(
      this.streamKey(taskId),
      fromId,
      "+",
    )) as Array<[string, string[]]>;
    return entries.map(([, fields]) => {
      const dataIdx = fields.indexOf("data");
      return JSON.parse(fields[dataIdx + 1]!) as TaskEvent;
    });
  }
}
```

- [ ] **Step 4: PASS** (requires `REDIS_URL` env in test setup; ensure local Redis is up).

### Task 2.5: TasksService — submit + get

**Files:**

- Create: `$CH/src/tasks/tasks.service.ts`
- Create: `$CH/src/tasks/tasks.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { TasksService } from "./tasks.service";
// import test fixtures: drizzle test DB, BullMQ Queue mock, TaskEventBus mock

describe("TasksService.submit", () => {
  it("inserts a row with status=pending and enqueues a BullMQ job", async () => {
    const svc = makeService(); // factory wires in test DB + mocked Queue
    const { taskId } = await svc.submit({
      taskType: "fake.echo",
      input: { hello: "world" },
      owner: { userId: "u1", botId: "b1", tenantId: "t1" },
    });
    const row = await getTask(taskId);
    expect(row.status).toBe("pending");
    expect(row.taskType).toBe("fake.echo");
    expect(mockQueue.add).toHaveBeenCalledWith(
      "run",
      { taskId },
      expect.any(Object),
    );
  });
});

describe("TasksService.get", () => {
  it("returns null when not owned by caller", async () => {
    const svc = makeService();
    const { taskId } = await svc.submit({
      taskType: "fake.echo",
      input: {},
      owner: { userId: "u1", botId: "b1", tenantId: "t1" },
    });
    const snap = await svc.get(taskId, {
      userId: "u2",
      botId: "b1",
      tenantId: "t1",
    });
    expect(snap).toBeNull();
  });

  it("returns snapshot for owner", async () => {
    const svc = makeService();
    const { taskId } = await svc.submit({
      taskType: "fake.echo",
      input: { foo: 1 },
      owner: testOwner,
    });
    const snap = await svc.get(taskId, testOwner);
    expect(snap).toMatchObject({
      id: taskId,
      taskType: "fake.echo",
      status: "pending",
      input: { foo: 1 },
    });
  });
});
```

- [ ] **Step 2: FAIL**.

- [ ] **Step 3: Implement**

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { eq, and } from "drizzle-orm";
import { DRIZZLE_PROVIDER } from "../database/database.constants";
import type { DrizzleDatabase } from "../database/database.provider";
import { tasks } from "../database/schema";
import type { Owner, TaskSnapshot } from "./types";

interface SubmitParams<TInput> {
  taskType: string;
  capabilityId?: string | null;
  input: TInput;
  owner: Owner;
  parentTaskId?: string;
  interactionId?: string;
  bullOptions?: { priority?: number; attempts?: number };
}

@Injectable()
export class TasksService {
  private readonly log = new Logger(TasksService.name);

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDatabase,
    @InjectQueue("tasks") private readonly queue: Queue,
  ) {}

  async submit<TInput>(p: SubmitParams<TInput>): Promise<{ taskId: string }> {
    const [row] = await this.db
      .insert(tasks)
      .values({
        taskType: p.taskType,
        capabilityId: p.capabilityId ?? null,
        input: p.input as never,
        ownerUserId: p.owner.userId,
        ownerBotId: p.owner.botId,
        ownerTenantId: p.owner.tenantId,
        parentTaskId: p.parentTaskId ?? null,
        interactionId: p.interactionId ?? null,
      })
      .returning({ id: tasks.id });
    await this.queue.add(
      "run",
      { taskId: row.id },
      {
        attempts: p.bullOptions?.attempts ?? 3,
        backoff: { type: "exponential", delay: 5000 },
        priority: p.bullOptions?.priority,
        removeOnComplete: { count: 1000, age: 86400 },
        removeOnFail: { count: 1000 },
      },
    );
    return { taskId: row.id };
  }

  async get(taskId: string, owner: Owner): Promise<TaskSnapshot | null> {
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.ownerUserId, owner.userId),
          eq(tasks.ownerTenantId, owner.tenantId),
        ),
      );
    if (!row) return null;
    return this.toSnapshot(row);
  }

  private toSnapshot(row: typeof tasks.$inferSelect): TaskSnapshot {
    return {
      id: row.id,
      taskType: row.taskType,
      capabilityId: row.capabilityId,
      status: row.status,
      input: row.input,
      result: row.result,
      error: row.error as TaskSnapshot["error"],
      owner: {
        userId: row.ownerUserId,
        botId: row.ownerBotId,
        tenantId: row.ownerTenantId,
      },
      parentTaskId: row.parentTaskId,
      interactionId: row.interactionId,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

- [ ] **Step 4: PASS**.

### Task 2.6: TasksService — list + cancel

**Files:**

- Modify: `$CH/src/tasks/tasks.service.ts`
- Modify: `$CH/src/tasks/tasks.service.spec.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe("TasksService.list", () => {
  it("paginates by createdAt desc and filters by taskType + status", async () => {
    const svc = makeService();
    // Create 3 tasks of mixed types
    const { taskId: t1 } = await svc.submit({
      taskType: "a",
      input: {},
      owner: testOwner,
    });
    const { taskId: t2 } = await svc.submit({
      taskType: "a",
      input: {},
      owner: testOwner,
    });
    const { taskId: t3 } = await svc.submit({
      taskType: "b",
      input: {},
      owner: testOwner,
    });
    await db.update(tasks).set({ status: "completed" }).where(eq(tasks.id, t2));

    const allA = await svc.list(testOwner, { taskType: "a" });
    expect(allA.items.map((i) => i.id)).toEqual([t2, t1]); // desc by createdAt; uuidv7 → time-sortable

    const completed = await svc.list(testOwner, { status: "completed" });
    expect(completed.items.map((i) => i.id)).toEqual([t2]);

    const limited = await svc.list(testOwner, { limit: 1 });
    expect(limited.items.length).toBe(1);
    expect(limited.hasMore).toBe(true);
  });
});

describe("TasksService.cancel", () => {
  it("marks status=cancelled, removes BullMQ job, publishes cancelled event", async () => {
    const svc = makeService();
    const { taskId } = await svc.submit({
      taskType: "fake.echo",
      input: {},
      owner: testOwner,
    });
    await svc.cancel(taskId, testOwner);
    const snap = await svc.get(taskId, testOwner);
    expect(snap?.status).toBe("cancelled");
    expect(snap?.completedAt).not.toBeNull();
    expect(mockQueue.getJob).toHaveBeenCalledWith(taskId);
    expect(mockJobInstance.remove).toHaveBeenCalled();
    expect(mockBus.publish).toHaveBeenCalledWith(
      taskId,
      expect.objectContaining({ event: "cancelled" }),
    );
  });

  it("is a no-op for terminal tasks (already completed/failed/cancelled)", async () => {
    const svc = makeService();
    const { taskId } = await svc.submit({
      taskType: "fake.echo",
      input: {},
      owner: testOwner,
    });
    await db
      .update(tasks)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(tasks.id, taskId));
    const beforeUpdated = (await svc.get(taskId, testOwner))?.updatedAt;
    const result = await svc.cancel(taskId, testOwner);
    expect(result.status).toBe("completed");
    expect(result.updatedAt).toEqual(beforeUpdated); // unchanged
    expect(mockBus.publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: FAIL**.

- [ ] **Step 3: Add implementations**

Add to `tasks.service.ts`:

```ts
import { TaskEventBus } from './task-event.bus';

// constructor add: private readonly bus: TaskEventBus,

async list(owner: Owner, q: { taskType?: string; status?: TaskStatus; page?: number; limit?: number }) {
  const limit = Math.min(q.limit ?? 50, 200);
  const offset = ((q.page ?? 1) - 1) * limit;
  const conds = [eq(tasks.ownerUserId, owner.userId), eq(tasks.ownerTenantId, owner.tenantId)];
  if (q.taskType) conds.push(eq(tasks.taskType, q.taskType));
  if (q.status) conds.push(eq(tasks.status, q.status));
  const rows = await this.db.select().from(tasks)
    .where(and(...conds))
    .orderBy(desc(tasks.createdAt))
    .limit(limit + 1).offset(offset);
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit).map((r) => this.toSnapshot(r)), page: q.page ?? 1, hasMore };
}

async cancel(taskId: string, owner: Owner): Promise<TaskSnapshot> {
  const current = await this.get(taskId, owner);
  if (!current) throw new NotFoundException(`task ${taskId} not found`);
  if (['completed','failed','cancelled'].includes(current.status)) return current;
  await this.db.update(tasks).set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, taskId));
  const job = await this.queue.getJob(taskId).catch(() => null);
  if (job) await job.remove().catch(() => {});
  await this.bus.publish(taskId, { seq: -1, event: 'cancelled', data: { reason: 'user_request' } });
  return (await this.get(taskId, owner))!;
}
```

(Adjust imports: `desc`, `NotFoundException`.)

- [ ] **Step 4: PASS**.

### Task 2.7: TasksService — stream

**Files:**

- Modify: `$CH/src/tasks/tasks.service.ts`

- [ ] **Step 1: Write the streaming method**

```ts
async *stream(taskId: string, owner: Owner, opts: { lastEventId?: string } = {}): AsyncIterable<TaskEvent> {
  // Validate ownership
  const snap = await this.get(taskId, owner);
  if (!snap) throw new NotFoundException();
  // Replay missed events
  const replayed = await this.bus.replay(taskId, opts.lastEventId ?? '0');
  for (const ev of replayed) yield ev;
  if (['completed','failed','cancelled'].includes(snap.status)) return;
  // Subscribe to live events
  const queue: TaskEvent[] = [];
  let resolve: ((v: void) => void) | null = null;
  const unsub = await this.bus.subscribe(taskId, (ev) => { queue.push(ev); resolve?.(); resolve = null; });
  try {
    while (true) {
      while (queue.length) { const ev = queue.shift()!; yield ev; if (['completed','failed','cancelled'].includes(String(ev.event))) return; }
      await new Promise<void>((r) => { resolve = r; });
    }
  } finally { await unsub(); }
}
```

- [ ] **Step 2: Add streaming test (mock bus.publish during yield)** and PASS.

### Task 2.8: TaskRunnerWorker (BullMQ Worker)

**Files:**

- Create: `$CH/src/tasks/task-runner.worker.ts`
- Create: `$CH/src/tasks/task-runner.worker.spec.ts`

- [ ] **Step 1: Tests cover: success path updates status=completed; throw → status=failed with error col; cancel signal propagates**

(Sketch — include the three assertion blocks; use a fake `EchoRunner` that returns `input` unchanged or throws based on `input.shouldThrow`.)

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

```ts
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Worker, Job } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import { DRIZZLE_PROVIDER } from "../database/database.constants";
import type { DrizzleDatabase } from "../database/database.provider";
import { tasks } from "../database/schema";
import { TaskRunnerRegistry } from "./task-runner.registry";
import { TaskEventBus } from "./task-event.bus";
import { TaskError } from "./types";

@Injectable()
export class TaskRunnerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TaskRunnerWorker.name);
  private worker?: Worker;
  private readonly aborts = new Map<string, AbortController>();

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDatabase,
    private readonly registry: TaskRunnerRegistry,
    private readonly bus: TaskEventBus,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.worker = new Worker("tasks", (job) => this.handle(job), {
      connection: { url: this.config.getOrThrow<string>("REDIS_URL") },
      stalledInterval: 30_000,
      lockDuration: 60_000,
      concurrency: Number(this.config.get("TASK_WORKER_CONCURRENCY") ?? 4),
    });
    this.worker.on("failed", (job, err) =>
      this.log.error(`job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    for (const ac of this.aborts.values()) ac.abort();
    await this.worker?.close();
  }

  cancel(taskId: string) {
    this.aborts.get(taskId)?.abort();
  }

  private async handle(job: Job<{ taskId: string }>) {
    const { taskId } = job.data;
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));
    if (!row) throw new Error(`task ${taskId} missing`);
    const runner = this.registry.get(row.taskType);
    if (!runner) throw new Error(`no runner for ${row.taskType}`);
    const ac = new AbortController();
    this.aborts.set(taskId, ac);
    let seq = 0;
    const emit = async (ev: { event?: string; data: unknown }) => {
      seq += 1;
      await this.bus.publish(taskId, { seq, ...ev });
    };
    try {
      await this.db
        .update(tasks)
        .set({
          status: "running",
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));
      const result = await runner.run({
        taskId,
        input: row.input,
        emit,
        signal: ac.signal,
        owner: {
          userId: row.ownerUserId,
          botId: row.ownerBotId,
          tenantId: row.ownerTenantId,
        },
      });
      await this.db
        .update(tasks)
        .set({
          status: "completed",
          result: result as never,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));
      await emit({ event: "completed", data: { result } });
    } catch (err) {
      const code = err instanceof TaskError ? err.code : "UNCAUGHT";
      const message = err instanceof Error ? err.message : String(err);
      const isAbort = ac.signal.aborted;
      const status = isAbort ? "cancelled" : "failed";
      await this.db
        .update(tasks)
        .set({
          status,
          error: { code, message } as never,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));
      await emit({ event: status, data: { error: { code, message } } });
      if (!isAbort) throw err;
    } finally {
      this.aborts.delete(taskId);
    }
  }
}
```

- [ ] **Step 4: PASS**.

### Task 2.9: Lift `ring-buffer.ts` from deep-research

**Files:**

- Create: `$CH/src/tasks/ring-buffer.ts` (copy-paste from `src/deep-research/ring-buffer.ts`)
- Note: do NOT yet delete the original; deletion happens in Phase 4 once deep-research is migrated.

- [ ] **Step 1: Copy**

```bash
cp $CH/src/deep-research/ring-buffer.ts $CH/src/tasks/ring-buffer.ts
```

### Task 2.10: TasksController + TaskStreamController + cancel endpoint

**Files:**

- Create: `$CH/src/tasks/tasks.controller.ts`
- Create: `$CH/src/tasks/task-stream.controller.ts`
- Create: `$CH/src/tasks/dto/list-tasks.dto.ts`
- Create: `$CH/src/tasks/dto/submit-task.dto.ts`

- [ ] **Step 1: DTOs**

`submit-task.dto.ts`:

```ts
import { IsString, IsOptional, MaxLength, IsObject } from "class-validator";
export class SubmitTaskDto {
  @IsString() @MaxLength(64) taskType!: string;
  @IsObject() input!: Record<string, unknown>;
  @IsOptional() @IsString() capabilityId?: string;
  @IsOptional() @IsString() parentTaskId?: string;
  @IsOptional() @IsString() interactionId?: string;
}
```

`list-tasks.dto.ts`:

```ts
import { IsOptional, IsString, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";
export class ListTasksDto {
  @IsOptional() @IsString() taskType?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
```

- [ ] **Step 2: TasksController**

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { TasksService } from "./tasks.service";
import { SubmitTaskDto } from "./dto/submit-task.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";

interface RequestUser {
  userId: string;
  botId: string;
  tenantId: string;
}
function ownerOf(req: Request): RequestUser {
  const u = (req as Request & { user?: RequestUser }).user;
  if (!u) throw new Error("Request missing authenticated user");
  return u;
}

@Controller("api/tasks")
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  @Post()
  @HttpCode(202)
  async submit(@Req() req: Request, @Body() dto: SubmitTaskDto) {
    return this.svc.submit({ ...dto, input: dto.input, owner: ownerOf(req) });
  }

  @Get()
  async list(@Req() req: Request, @Query() q: ListTasksDto) {
    return this.svc.list(ownerOf(req), q as never);
  }

  @Get(":id")
  async get(@Req() req: Request, @Param("id") id: string) {
    const t = await this.svc.get(id, ownerOf(req));
    if (!t) throw new NotFoundException();
    return t;
  }

  @Post(":id/cancel")
  async cancel(@Req() req: Request, @Param("id") id: string) {
    return this.svc.cancel(id, ownerOf(req));
  }
}
```

- [ ] **Step 3: TaskStreamController**

```ts
import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { TasksService } from "./tasks.service";

@Controller("api/tasks")
export class TaskStreamController {
  constructor(private readonly svc: TasksService) {}

  @Get(":id/stream")
  async stream(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ) {
    const owner = (
      req as Request & {
        user: { userId: string; botId: string; tenantId: string };
      }
    ).user;
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();
    const lastEventId = req.headers["last-event-id"] as string | undefined;
    const abort = new AbortController();
    req.on("close", () => abort.abort());
    try {
      for await (const ev of this.svc.stream(id, owner, { lastEventId })) {
        if (abort.signal.aborted) break;
        res.write(`id: ${ev.seq}\n`);
        if (ev.event) res.write(`event: ${ev.event}\n`);
        res.write(`data: ${JSON.stringify(ev.data)}\n\n`);
      }
    } finally {
      res.end();
    }
  }
}
```

- [ ] **Step 4: Wire controllers into TasksModule**

Update `tasks.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import Redis from "ioredis";
import { ConfigService } from "@nestjs/config";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";
import { TaskStreamController } from "./task-stream.controller";
import { TaskRunnerRegistry } from "./task-runner.registry";
import { TaskRunnerWorker } from "./task-runner.worker";
import { TaskEventBus } from "./task-event.bus";
import { StartupRecoveryService } from "./startup-recovery.service";

const REDIS_PUB = "TASKS_REDIS_PUB";
const REDIS_SUB = "TASKS_REDIS_SUB";

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        connection: { url: cfg.getOrThrow("REDIS_URL") },
      }),
    }),
    BullModule.registerQueue({ name: "tasks" }),
  ],
  controllers: [TasksController, TaskStreamController],
  providers: [
    {
      provide: REDIS_PUB,
      useFactory: (cfg: ConfigService) =>
        new Redis(cfg.getOrThrow("REDIS_URL")),
      inject: [ConfigService],
    },
    {
      provide: REDIS_SUB,
      useFactory: (cfg: ConfigService) =>
        new Redis(cfg.getOrThrow("REDIS_URL")),
      inject: [ConfigService],
    },
    {
      provide: TaskEventBus,
      useFactory: (pub, sub) => new TaskEventBus(pub, sub),
      inject: [REDIS_PUB, REDIS_SUB],
    },
    TaskRunnerRegistry,
    TaskRunnerWorker,
    TasksService,
    StartupRecoveryService,
  ],
  exports: [TasksService, TaskRunnerRegistry],
})
export class TasksModule {}
```

### Task 2.11: StartupRecoveryService

**Files:**

- Create: `$CH/src/tasks/startup-recovery.service.ts`
- Create: `$CH/src/tasks/startup-recovery.service.spec.ts`

- [ ] **Step 1: Test**

```ts
it('marks orphan running tasks as failed on boot', async () => {
  await db.insert(tasks).values({ ..., status: 'running' });
  const svc = new StartupRecoveryService(db);
  await svc.onModuleInit();
  const [row] = await db.select().from(tasks).where(eq(tasks.id, …));
  expect(row.status).toBe('failed');
  expect(row.error).toEqual({ code: 'WORKER_DIED', message: expect.any(String) });
});
```

- [ ] **Step 2: Impl**

```ts
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE_PROVIDER } from "../database/database.constants";
import type { DrizzleDatabase } from "../database/database.provider";
import { tasks } from "../database/schema";

@Injectable()
export class StartupRecoveryService implements OnModuleInit {
  private readonly log = new Logger(StartupRecoveryService.name);
  constructor(@Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDatabase) {}

  async onModuleInit() {
    const result = await this.db
      .update(tasks)
      .set({
        status: "failed",
        error: {
          code: "WORKER_DIED",
          message: "Worker died before completion",
        } as never,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.status, "running"))
      .returning({ id: tasks.id });
    if (result.length)
      this.log.warn(`recovered ${result.length} orphaned task(s)`);
  }
}
```

### Task 2.12: Multi-instance integration test

**Files:**

- Create: `$CH/test/tasks-multi-instance.e2e-spec.ts`

- [ ] **Step 1: Test**

Spin up two instances of `TasksModule` (two `Test.createTestingModule` calls), register a fake runner only on instance B, submit a task via instance A's TasksService — verify B picks it up and instance A's stream subscriber receives the events. Use real Redis from docker-compose, real Postgres test DB.

```ts
it("worker on instance B emits events visible to subscriber on instance A", async () => {
  /* … see brief … */
});
```

- [ ] **Step 2: PASS**.

### Task 2.13: Auto-redirect `/api/invoke/:capabilityId` for async capabilities

**Files:**

- Modify: `$CH/src/proxy/proxy.controller.ts` (or wherever `/api/invoke/:id` is mounted — verify with `grep -rn "@Post.*invoke" src/`)
- Modify: `$CH/src/proxy/proxy.service.ts`

> **Why:** agent-pi's `CapabilityHubClient.invokeCapability(...)` currently POSTs to `/api/invoke/:id`. We do not want agent-pi to special-case async caps before the call. The hub itself should detect `capability.metadata.async === true` and route to TasksService internally, returning `{ taskId }` with status 202.

- [ ] **Step 1: Test**

```ts
it('auto-redirects async capability to TaskService.submit', async () => {
  const cap = await caps.upsertByName({ name: 'fake_async', type: 'tool', metadata: { async: true, taskType: 'fake.echo' }, ... });
  const res = await request(app.getHttpServer())
    .post(`/api/invoke/${cap.id}`)
    .set(testAuthHeaders)
    .send({ payload: { hello: 'world' } });
  expect(res.status).toBe(202);
  expect(res.body).toMatchObject({ taskId: expect.any(String) });
  // and a row exists in tasks table
});

it('keeps sync capabilities on legacy path', async () => {
  // existing sync-capability behavior unchanged
});
```

- [ ] **Step 2: Implementation**

In `proxy.service.ts`, before invoking the strategy:

```ts
async invoke(capabilityId: string, dto: InvokeDto, owner: Owner) {
  const cap = await this.caps.getById(capabilityId);
  if (!cap) throw new NotFoundException();
  if (cap.metadata?.async === true) {
    const taskType = cap.metadata.taskType as string | undefined;
    if (!taskType) throw new InternalServerErrorException(`async cap ${capabilityId} missing metadata.taskType`);
    return this.tasks.submit({
      taskType,
      capabilityId,
      input: dto.payload,
      owner,
    });
  }
  // existing sync path unchanged
  return this.legacyInvoke(cap, dto, owner);
}
```

In the controller, set `@HttpCode(202)` on the route OR check the response shape and set status code dynamically. Simplest: have the service throw a custom thrown `AsyncSubmitted` and catch in an interceptor that sets 202 — but cheaper: have the service return a tagged union and the controller selects status:

```ts
@Post(':id')
async invoke(@Req() req, @Param('id') id, @Body() dto, @Res() res) {
  const result = await this.svc.invoke(id, dto, ownerOf(req));
  res.status('taskId' in result ? 202 : 200).json(result);
}
```

- [ ] **Step 3: PASS** + verify existing sync proxy tests still PASS.

### Task 2.14: Commit Phase 2

```bash
cd $CH && git add -A && git commit -m "feat(tasks): generic BullMQ-backed long-task module with SSE relay"
```

---

## Phase 3 — capability-hub: Seedance module

### Task 3.1: OpenRouter Seedance client wrapper

**Files:**

- Create: `$CH/src/seedance/openrouter.client.ts`
- Create: `$CH/src/seedance/openrouter.client.spec.ts`

- [ ] **Step 1: Tests with mocked fetch**

```ts
describe("OpenRouterSeedanceClient", () => {
  it("submits a generation request and returns upstream job id", async () => {
    fetchMock.post("https://openrouter.ai/api/v1/...", {
      id: "jobX",
      status: "pending",
    });
    const c = new OpenRouterSeedanceClient({ apiKey: "sk-test" });
    const r = await c.submitVideoJob({
      model: "bytedance/seedance-2.0-fast",
      prompt: "a cat",
      durationSec: 5,
      aspectRatio: "16:9",
    });
    expect(r.jobId).toBe("jobX");
  });

  it("polls job status", async () => {
    /* … returns { state: 'running'|'succeeded'|'failed', videoUrl? } */
  });

  it("cancels best-effort and swallows 404", async () => {
    fetchMock.post("https://openrouter.ai/api/v1/generation/jobX/cancel", {
      status: 404,
      body: { error: "not found" },
    });
    const c = new OpenRouterSeedanceClient({ apiKey: "sk-test" });
    await expect(c.cancelJob("jobX")).resolves.toBeUndefined(); // does not throw on 404
  });

  it("throws on non-2xx submit", async () => {
    fetchMock.post("https://openrouter.ai/api/v1/generation", {
      status: 401,
      body: { error: "unauthorized" },
    });
    const c = new OpenRouterSeedanceClient({ apiKey: "sk-bad" });
    await expect(
      c.submitVideoJob({
        model: "bytedance/seedance-2.0-fast",
        prompt: "x",
        durationSec: 5,
        aspectRatio: "16:9",
      }),
    ).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: FAIL**.

- [ ] **Step 3: Impl**

```ts
import { Injectable, Logger } from "@nestjs/common";

interface SubmitParams {
  model: "bytedance/seedance-2.0" | "bytedance/seedance-2.0-fast";
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  seed?: number | null;
  signal?: AbortSignal;
}
interface SubmitResult {
  jobId: string;
}
interface PollResult {
  state: "pending" | "running" | "succeeded" | "failed";
  videoUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSec?: number;
  costUsd?: number;
  error?: string;
}

@Injectable()
export class OpenRouterSeedanceClient {
  private readonly log = new Logger(OpenRouterSeedanceClient.name);
  private readonly baseUrl = "https://openrouter.ai/api/v1";
  constructor(private readonly opts: { apiKey: string }) {}

  async submitVideoJob(p: SubmitParams): Promise<SubmitResult> {
    const res = await fetch(`${this.baseUrl}/generation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: p.model,
        input: {
          prompt: p.prompt,
          duration: p.durationSec,
          aspect_ratio: p.aspectRatio,
          seed: p.seed,
        },
      }),
      signal: p.signal,
    });
    if (!res.ok)
      throw new Error(
        `OpenRouter submit failed: ${res.status} ${await res.text()}`,
      );
    const json = (await res.json()) as { id: string };
    return { jobId: json.id };
  }

  async getJobState(
    jobId: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<PollResult> {
    const res = await fetch(`${this.baseUrl}/generation/${jobId}`, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      signal: opts.signal,
    });
    if (!res.ok)
      throw new Error(
        `OpenRouter poll failed: ${res.status} ${await res.text()}`,
      );
    const json = (await res.json()) as Record<string, unknown>;
    // Map OpenRouter response to PollResult
    return {
      state: json["status"] as PollResult["state"],
      videoUrl: json["output_url"] as string | undefined,
      mimeType: json["output_mime"] as string | undefined,
      durationSec: json["duration"] as number | undefined,
      costUsd: json["cost_usd"] as number | undefined,
      error: json["error"] as string | undefined,
    };
  }

  async cancelJob(jobId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/generation/${jobId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    if (!res.ok && res.status !== 404)
      this.log.warn(`cancel ${jobId} returned ${res.status}`);
  }
}
```

> **Note:** the request/response field names above (`output_url`, `cost_usd`, etc.) are the spec's working assumption as of 2026-04-27. **Verify against the OpenRouter Seedance docs the day this is implemented**; if they differ, update only this file — no callers depend on the field names. Add `it.todo('matches OpenRouter docs as of 2026-04-27 — re-verify quarterly')` to catch drift in CI review.

- [ ] **Step 4: PASS**.

### Task 3.2: SeedanceTaskHandler

**Files:**

- Create: `$CH/src/seedance/seedance-task.handler.ts`
- Create: `$CH/src/seedance/seedance-task.handler.spec.ts`

- [ ] **Step 1: Tests**

```ts
describe("SeedanceTaskHandler", () => {
  it("completes when OpenRouter returns succeeded with videoUrl", async () => {
    const client = mockClient({
      submit: { jobId: "j1" },
      polls: [
        { state: "pending" },
        {
          state: "succeeded",
          videoUrl: "https://x/v.mp4",
          mimeType: "video/mp4",
          durationSec: 5,
        },
      ],
    });
    const h = new SeedanceTaskHandler(client);
    const result = await h.run({
      taskId: "t1",
      input: {
        prompt: "cat",
        mode: "fast",
        durationSec: 5,
        aspectRatio: "16:9",
      },
      emit: noopEmit,
      signal: new AbortController().signal,
      owner: testOwner,
    });
    expect(result).toMatchObject({
      videoUrl: "https://x/v.mp4",
      mimeType: "video/mp4",
    });
  });

  it("throws TaskError on upstream failure", async () => {
    const client = mockClient({
      submit: { jobId: "j1" },
      polls: [{ state: "failed", error: "content policy" }],
    });
    const h = new SeedanceTaskHandler(client);
    await expect(
      h.run({
        taskId: "t1",
        input: { prompt: "x" },
        emit: noopEmit,
        signal: new AbortController().signal,
        owner: testOwner,
      }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_FAILED",
      message: expect.stringContaining("content policy"),
    });
  });

  it("aborts polling and calls cancelJob on signal", async () => {
    const ac = new AbortController();
    const client = mockClient({
      submit: { jobId: "j1" },
      polls: new Array(20).fill({ state: "running" }),
    });
    const h = new SeedanceTaskHandler(client);
    setTimeout(() => ac.abort(), 20);
    await expect(
      h.run({
        taskId: "t1",
        input: { prompt: "x" },
        emit: noopEmit,
        signal: ac.signal,
        owner: testOwner,
      }),
    ).rejects.toThrow();
    expect(client.cancelJob).toHaveBeenCalledWith("j1");
  });
});
```

- [ ] **Step 2: FAIL**.

- [ ] **Step 3: Impl**

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { TaskRunner, TaskRunnerContext } from "../tasks/types";
import { TaskError } from "../tasks/types";
import { OpenRouterSeedanceClient } from "./openrouter.client";

interface SeedanceInput {
  prompt: string;
  mode?: "fast" | "quality";
  durationSec?: number;
  aspectRatio?: string;
  seed?: number | null;
}
interface SeedanceResult {
  videoUrl: string;
  mimeType: string;
  durationSec?: number;
  sizeBytes?: number;
  costUsd?: number;
  upstreamJobId: string;
}

const TERMINAL_GOOD = new Set(["succeeded"]);
const TERMINAL_BAD = new Set(["failed"]);
const POLL_INTERVAL_MS = 5000;
const MAX_DURATION_MS = 240_000;

@Injectable()
export class SeedanceTaskHandler implements TaskRunner<
  SeedanceInput,
  SeedanceResult
> {
  readonly taskType = "seedance.generate";
  private readonly log = new Logger(SeedanceTaskHandler.name);

  constructor(private readonly openrouter: OpenRouterSeedanceClient) {}

  async run(ctx: TaskRunnerContext<SeedanceInput>): Promise<SeedanceResult> {
    const model =
      ctx.input.mode === "quality"
        ? "bytedance/seedance-2.0"
        : "bytedance/seedance-2.0-fast";
    await ctx.emit({ event: "started", data: { model } });

    const submit = await this.openrouter.submitVideoJob({
      model,
      prompt: ctx.input.prompt,
      durationSec: ctx.input.durationSec ?? 5,
      aspectRatio: ctx.input.aspectRatio ?? "16:9",
      seed: ctx.input.seed ?? undefined,
      signal: ctx.signal,
    });
    await ctx.emit({
      event: "progress",
      data: { upstreamJobId: submit.jobId, phase: "submitted" },
    });

    const startedAt = Date.now();
    let lastState: string = "pending";
    while (true) {
      if (ctx.signal.aborted) {
        await this.openrouter.cancelJob(submit.jobId).catch(() => {});
        throw new TaskError("CANCELLED", "cancelled by caller");
      }
      if (Date.now() - startedAt > MAX_DURATION_MS) {
        await this.openrouter.cancelJob(submit.jobId).catch(() => {});
        throw new TaskError("TIMEOUT", `exceeded ${MAX_DURATION_MS}ms`);
      }
      await sleep(POLL_INTERVAL_MS, ctx.signal);
      const poll = await this.openrouter.getJobState(submit.jobId, {
        signal: ctx.signal,
      });
      if (poll.state !== lastState) {
        lastState = poll.state;
        await ctx.emit({
          event: "progress",
          data: { state: poll.state, elapsedMs: Date.now() - startedAt },
        });
      }
      if (TERMINAL_GOOD.has(poll.state) && poll.videoUrl) {
        return {
          videoUrl: poll.videoUrl,
          mimeType: poll.mimeType ?? "video/mp4",
          durationSec: poll.durationSec,
          sizeBytes: poll.sizeBytes,
          costUsd: poll.costUsd,
          upstreamJobId: submit.jobId,
        };
      }
      if (TERMINAL_BAD.has(poll.state)) {
        throw new TaskError(
          "UPSTREAM_FAILED",
          poll.error ?? "OpenRouter reported failed",
        );
      }
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
```

- [ ] **Step 4: PASS**.

### Task 3.3: SeedanceCostStrategy

**Files:**

- Create: `$CH/src/seedance/seedance-cost.strategy.ts`
- Create: `$CH/src/seedance/seedance-cost.strategy.spec.ts`

- [ ] **Step 1: Tests**

```ts
it("uses OpenRouter-reported cost when present", () => {
  const s = new SeedanceCostStrategy();
  expect(s.compute({ result: { costUsd: 0.123, durationSec: 5 } })).toBeCloseTo(
    0.123,
  );
});
it("falls back to static (model, durationSec) table", () => {
  const s = new SeedanceCostStrategy();
  expect(
    s.compute({ input: { mode: "fast", durationSec: 5 } }),
  ).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Impl**

```ts
import { Injectable } from "@nestjs/common";

const FALLBACK_TABLE = {
  fast: { 3: 0.05, 5: 0.07, 10: 0.13 } as Record<number, number>,
  quality: { 3: 0.2, 5: 0.3, 10: 0.55 } as Record<number, number>,
};

@Injectable()
export class SeedanceCostStrategy {
  compute(p: {
    input?: { mode?: "fast" | "quality"; durationSec?: number };
    result?: { costUsd?: number; durationSec?: number };
  }): number {
    if (typeof p.result?.costUsd === "number") return p.result.costUsd;
    const mode = p.input?.mode ?? "fast";
    const sec = p.input?.durationSec ?? 5;
    return FALLBACK_TABLE[mode][sec] ?? FALLBACK_TABLE[mode][5];
  }
}
```

### Task 3.4: SeedanceService — onModuleInit registration

**Files:**

- Create: `$CH/src/seedance/seedance.service.ts`
- Create: `$CH/src/seedance/seedance.module.ts`

- [ ] **Step 1: Module**

```ts
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SeedanceService } from "./seedance.service";
import { SeedanceTaskHandler } from "./seedance-task.handler";
import { SeedanceCostStrategy } from "./seedance-cost.strategy";
import { OpenRouterSeedanceClient } from "./openrouter.client";
import { TasksModule } from "../tasks/tasks.module";
import { CapabilitiesModule } from "../capabilities/capabilities.module";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [TasksModule, CapabilitiesModule, BillingModule],
  providers: [
    {
      provide: OpenRouterSeedanceClient,
      useFactory: (cfg: ConfigService) =>
        new OpenRouterSeedanceClient({
          apiKey: cfg.getOrThrow("OPENROUTER_API_KEY"),
        }),
      inject: [ConfigService],
    },
    SeedanceTaskHandler,
    SeedanceCostStrategy,
    SeedanceService,
  ],
})
export class SeedanceModule {}
```

(If the existing module names differ — verify: `grep -rln "@Module" src/billing` etc. — adapt the imports.)

- [ ] **Step 2: Service**

```ts
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { CapabilitiesService } from "../capabilities/capabilities.service";
import { TaskRunnerRegistry } from "../tasks/task-runner.registry";
import { SeedanceTaskHandler } from "./seedance-task.handler";

const CAPABILITY_DEF = {
  name: "seedance_generate_video",
  type: "tool" as const,
  status: "active" as const,
  description:
    "Generate a short video from a text prompt using Bytedance Seedance. After successful generation, call SendVideo with the returned URL to deliver to the channel.",
  tags: ["video", "media", "generative", "long-task"],
  metadata: {
    async: true,
    taskType: "seedance.generate",
    estimatedDurationMs: 60000,
    maxDurationMs: 240000,
    pollIntervalMs: 3000,
  },
  parametersSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        maxLength: 1200,
        description: "Scene description.",
      },
      mode: { type: "string", enum: ["fast", "quality"], default: "fast" },
      durationSec: { type: "integer", minimum: 3, maximum: 10, default: 5 },
      aspectRatio: {
        type: "string",
        enum: ["16:9", "9:16", "1:1", "4:3", "3:4"],
        default: "16:9",
      },
      seed: {
        type: ["integer", "null"],
        description: "Random seed for reproducibility.",
      },
    },
    required: ["prompt"],
  },
};

@Injectable()
export class SeedanceService implements OnModuleInit {
  private readonly log = new Logger(SeedanceService.name);

  constructor(
    private readonly caps: CapabilitiesService,
    private readonly registry: TaskRunnerRegistry,
    private readonly handler: SeedanceTaskHandler,
  ) {}

  async onModuleInit() {
    await this.caps.upsertByName(CAPABILITY_DEF);
    this.registry.register(this.handler);
    this.log.log("Seedance capability registered");
  }
}
```

(`upsertByName` — if `CapabilitiesService` doesn't have it yet, add it as a thin wrapper around the existing insert/update logic; keep the change scoped.)

- [ ] **Step 3: Wire SeedanceModule into AppModule**

```ts
// $CH/src/app.module.ts imports: [..., SeedanceModule]
```

- [ ] **Step 4: Boot test**

```bash
cd $CH && pnpm dev
# Look for log line: "Seedance capability registered"
# Verify in DB: psql $DATABASE_URL -c "select name from capabilities where name='seedance_generate_video'"
```

### Task 3.5: Wire billing on completion

> **Why:** spec § 4.4 requires a `tool_invocations` + `billing_outbox` row written on successful Seedance completion using the cost strategy. Failures and cancellations: no charge in v1 (spec § 12 R5).

**Files:**

- Modify: `$CH/src/seedance/seedance-task.handler.ts`
- Modify: `$CH/src/seedance/seedance-task.handler.spec.ts`

- [ ] **Step 1: Test**

```ts
it('records a tool_invocations + billing_outbox row on successful completion', async () => {
  const billing = makeMockBilling();
  const h = new SeedanceTaskHandler(mockClient({ ... succeed }), new SeedanceCostStrategy(), billing);
  await h.run({ ..., owner: { userId: 'u1', botId: 'b1', tenantId: 't1' } });
  expect(billing.record).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'u1', botId: 'b1', tenantId: 't1',
    capabilityId: expect.any(String),
    provider: 'openrouter',
    upstreamCostUsd: expect.any(Number),
    latencyMs: expect.any(Number),
  }));
});

it('does NOT record billing on failure', async () => {
  const billing = makeMockBilling();
  const h = new SeedanceTaskHandler(mockClient({ ... fail }), new SeedanceCostStrategy(), billing);
  await expect(h.run({ ... })).rejects.toThrow();
  expect(billing.record).not.toHaveBeenCalled();
});

it('does NOT record billing on cancel', async () => { /* abort the signal mid-poll */ });
```

- [ ] **Step 2: Inject `BillingService` (existing — see `src/billing/billing.service.ts`) + `SeedanceCostStrategy` into the handler's constructor**

```ts
constructor(
  private readonly openrouter: OpenRouterSeedanceClient,
  private readonly cost: SeedanceCostStrategy,
  private readonly billing: BillingService,
) {}
```

- [ ] **Step 3: After successful return, before `return result`** in `run()`:

```ts
const upstreamCostUsd = this.cost.compute({ input: ctx.input, result });
await this.billing.record({
  userId: ctx.owner.userId,
  botId: ctx.owner.botId,
  tenantId: ctx.owner.tenantId,
  capabilityId: <get from injected ConfigService or pass via ctx>,   // store at module init
  provider: 'openrouter',
  upstreamCostUsd,
  latencyMs: Date.now() - startedAt,
}).catch((err) => this.log.error(`billing record failed: ${err.message}`));
```

> The `capabilityId` for `seedance_generate_video` is known after `SeedanceService.onModuleInit` upserts the row. Cache it on the SeedanceService and inject into the handler via a method `bindCapabilityId(id: string)` called from `onModuleInit`. Alternatively, look it up by name on first run and memoize.

- [ ] **Step 4: PASS**.

### Task 3.6: E2E test against mocked OpenRouter

**Files:**

- Create: `$CH/test/seedance-e2e.spec.ts`

- [ ] **Step 1: Test**

Boot a real `TasksModule` + `SeedanceModule`. Mock the `OpenRouterSeedanceClient` to return `succeeded` after one poll. Submit via TasksService.submit, subscribe to stream, assert: `started → progress → completed` event sequence; final `result.videoUrl` matches; `tasks` row status='completed'.

- [ ] **Step 2: PASS**.

### Task 3.7: Commit Phase 3

```bash
cd $CH && git add -A && git commit -m "feat(seedance): register video generation capability with TaskRunner + cost strategy"
```

---

## Phase 4 — capability-hub: deep-research migration

> **Strategy:** Keep public URLs (`POST /deep-research/tasks`, `GET /:id/stream`) byte-identical from a contract standpoint. Internally route through TasksService. Dual-write `research_tasks` and `tasks` for one release window, then drop the legacy table.

### Task 4.1: Add task_type='deep_research' write path

**Files:**

- Modify: `$CH/src/deep-research/deep-research.service.ts`

- [ ] **Step 1: Write contract test that pins existing public behavior**

`$CH/test/deep-research-contract.spec.ts` — replay a known-good request and assert SSE event names + payload schemas (use the existing `deep-research.service.spec.ts` as the data oracle).

- [ ] **Step 2: Make `createTask()` write to BOTH `research_tasks` (legacy) and `tasks` (new)**

Within the same DB transaction. Use the same `id` (uuidv7) so both rows match.

- [ ] **Step 3: Smoke test**

```bash
cd $CH && pnpm test -- deep-research
```

Expected: existing tests pass; both rows present after `createTask`.

### Task 4.2: Refactor task-runner.service into DeepResearchTaskHandler

**Files:**

- Create: `$CH/src/deep-research/deep-research-task.handler.ts`
- Modify: `$CH/src/deep-research/deep-research.service.ts`
- Modify: `$CH/src/deep-research/deep-research.module.ts`

- [ ] **Step 1: Wrap existing runner logic in TaskRunner interface**

```ts
@Injectable()
export class DeepResearchTaskHandler implements TaskRunner<
  DeepResearchInput,
  DeepResearchResult
> {
  readonly taskType = "deep_research";
  constructor(
    private readonly persister: EventPersisterService,
    private readonly gemini: GeminiClientService,
    private readonly fileSvc: FileService,
    private readonly billing: DeepResearchBillingService,
  ) {}
  async run(
    ctx: TaskRunnerContext<DeepResearchInput>,
  ): Promise<DeepResearchResult> {
    // Body: move from src/deep-research/task-runner.service.ts:start(taskId, createParams)
    //   - Replace `for (const sub of handle.subscribers) sub.onEvent(ev)` with `await ctx.emit({ event: ev.type, data: ev.payload })`
    //   - Replace `handle.done = (async () => {...})()` with the inlined async loop body returned to caller
    //   - Drop subscriber set entirely; the new TaskEventBus is the broadcast layer
    //   - Honor ctx.signal — pass through to `gemini.invoke(..., { signal: ctx.signal })` calls
    //   - Return the same shape that becomes `tasks.result` (e.g. `{ finalReportS3, eventsArchiveS3, summary }`)
  }
}
```

- [ ] **Step 2: Register handler in DeepResearchModule.onModuleInit** (parallel to SeedanceService).

- [ ] **Step 3: Replace `DeepResearchService.createTask()` body to call `TasksService.submit({ taskType: 'deep_research', ... })`** while still maintaining the legacy `research_tasks` row in dual-write.

- [ ] **Step 4: Run contract test from 4.1, verify still PASS**.

### Task 4.3: Switch SSE relay to TaskEventBus

**Files:**

- Modify: `$CH/src/deep-research/deep-research.controller.ts`
- Delete: `$CH/src/deep-research/sse-relay.service.ts` (only after wiring switch)

- [ ] **Step 1: Modify `deep-research.controller.ts` `stream` method to delegate to `TasksService.stream`** while preserving URL `/deep-research/tasks/:id/stream`. Convert payload back into the legacy event shape if needed (compare against `sse-relay.service.spec.ts` golden output).

- [ ] **Step 2: Run contract test, verify PASS**.

- [ ] **Step 3: Delete `sse-relay.service.ts` and references**

```bash
rm $CH/src/deep-research/sse-relay.service.ts $CH/src/deep-research/sse-relay.service.spec.ts $CH/src/deep-research/ring-buffer.ts $CH/src/deep-research/ring-buffer.spec.ts
```

(`ring-buffer` is now in `tasks/`.)

- [ ] **Step 4: Update DeepResearchModule to remove deleted providers**.

### Task 4.4: Remove bespoke startup-recovery

**Files:**

- Delete: `$CH/src/deep-research/startup-recovery.service.ts`
- Delete: `$CH/src/deep-research/startup-recovery.service.spec.ts`

- [ ] **Step 1: Verify generic `tasks/startup-recovery.service.ts` covers the same assertions** (it operates on `tasks` table; deep-research rows are now there).

- [ ] **Step 2: Delete + remove from module**.

- [ ] **Step 3: Run all deep-research tests**

```bash
cd $CH && pnpm test -- src/deep-research
```

### Task 4.5: Remove old TaskRunnerService

**Files:**

- Delete: `$CH/src/deep-research/task-runner.service.ts`
- Delete: `$CH/src/deep-research/task-runner.service.spec.ts`

- [ ] **Step 1: Verify `DeepResearchTaskHandler` covers all behaviors of the old runner** by checking `task-runner.service.spec.ts` cases are reproduced against the new handler.

- [ ] **Step 2: Delete files + clean module references**.

### Task 4.6: Backfill script for existing research_tasks rows

**Files:**

- Create: `$CH/src/scripts/migrate-research-tasks-to-tasks.ts`

- [ ] **Step 1: Script**

```ts
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { tasks, researchTasks } from "../database/schema";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const db = drizzle(client);
  const rows = await db.select().from(researchTasks);
  let n = 0;
  for (const r of rows) {
    await db
      .insert(tasks)
      .values({
        id: r.id,
        taskType: "deep_research",
        capabilityId: r.capabilityId,
        ownerUserId: r.ownerUserId,
        ownerBotId: r.ownerBotId,
        ownerTenantId: r.ownerTenantId,
        parentTaskId: r.parentTaskId,
        interactionId: r.interactionId,
        status: r.status,
        input: r.input,
        result: null,
        resultMeta: {
          final_report_s3: r.finalReportS3,
          events_archive_s3: r.eventsArchiveS3,
        },
        toolsConfig: r.toolsConfig,
        storeRefs: r.storeRefs,
        error: r.error,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })
      .onConflictDoNothing();
    n++;
  }
  console.log(`migrated ${n} rows`);
  await client.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add to `package.json` scripts**: `"migrate:deep-research": "tsx src/scripts/migrate-research-tasks-to-tasks.ts"`.

- [ ] **Step 3: Run on dev DB**

```bash
cd $CH && pnpm migrate:deep-research
```

### Task 4.7: Commit Phase 4

```bash
cd $CH && git add -A && git commit -m "refactor(deep-research): migrate onto generic TasksModule (dual-write window)"
```

> **Follow-up (NOT this PR):** after one release with no rollback, drop `research_tasks` table + remove dual-write code path. Add to follow-up issue list, do not include in this plan.

---

## Phase 5 — agent-pi: async-task-executor

### Task 5.1: Extend CapabilityHubClient

**Files:**

- Modify: `$AP/packages/claw-hive/src/components/team9-capability-hub/client.ts`
- Modify: `$AP/packages/claw-hive/src/components/team9-capability-hub/client.test.ts` (create if missing)

- [ ] **Step 1: Tests for `getTask` and `cancelTask`**

```ts
describe("CapabilityHubClient.getTask", () => {
  it("GETs /api/tasks/:id with bearer auth", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "t1",
          status: "completed",
          result: { videoUrl: "X" },
        }),
      });
    const c = new CapabilityHubClient(
      { baseUrl: "http://hub", authToken: "tok" },
      fetchMock,
    );
    const r = await c.getTask("t1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://hub/api/tasks/t1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
    expect(r.status).toBe("completed");
  });
});

describe("invokeCapability with async response", () => {
  it("passes through 202 { taskId } shape", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({ taskId: "tid-async" }),
      });
    const c = new CapabilityHubClient(
      { baseUrl: "http://hub", authToken: "tok" },
      fetchMock,
    );
    const r = await c.invokeCapability("cap-async", { x: 1 });
    expect(r).toEqual({ taskId: "tid-async" });
  });
});
```

- [ ] **Step 2: Implementation**

Add methods to existing `CapabilityHubClient`:

```ts
async getTask(taskId: string, signal?: AbortSignal): Promise<TaskSnapshot> {
  const res = await this.fetch(`${this.baseUrl}/api/tasks/${taskId}`, { headers: this.authHeaders(), signal });
  if (!res.ok) throw new Error(`getTask ${taskId} failed: ${res.status}`);
  return res.json() as Promise<TaskSnapshot>;
}

async cancelTask(taskId: string, signal?: AbortSignal): Promise<void> {
  const res = await this.fetch(`${this.baseUrl}/api/tasks/${taskId}/cancel`, { method: 'POST', headers: this.authHeaders(), signal });
  if (!res.ok && res.status !== 404) throw new Error(`cancelTask ${taskId} failed: ${res.status}`);
}
```

Define `TaskSnapshot` type next to the methods (import-free, structural).

- [ ] **Step 3: PASS**.

### Task 5.2: async-task-executor

**Files:**

- Create: `$AP/packages/claw-hive/src/components/team9-capability-hub/async-task-executor.ts`
- Create: `$AP/packages/claw-hive/src/components/team9-capability-hub/async-task-executor.test.ts`

- [ ] **Step 1: Tests covering the lifecycle**

```ts
describe('createAsyncTaskExecutor', () => {
  it('returns ToolResult with stringified result on completed', async () => {
    const client = mockClient({
      invokeCapability: { taskId: 't1' },
      getTaskSequence: [
        { status: 'pending' },
        { status: 'running' },
        { status: 'completed', result: { videoUrl: 'https://x/v.mp4', mimeType: 'video/mp4' } },
      ],
    });
    const exec = createAsyncTaskExecutor(client, { id: 'cap1', metadata: { async: true, pollIntervalMs: 10 } });
    const updates: unknown[] = [];
    const result = await exec({ toolCallId: 'tc1', args: { prompt: 'cat' }, signal: new AbortController().signal, onUpdate: (u) => updates.push(u), ctx: {} as never });
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('videoUrl') });
    expect(updates.length).toBeGreaterThan(0);
  });

  it('throws on failed task with error message', async () => {
    const client = mockClient({
      invokeCapability: { taskId: 't1' },
      getTaskSequence: [{ status: 'running' }, { status: 'failed', error: { code: 'UPSTREAM_FAILED', message: 'safety filter triggered' } }],
    });
    const exec = createAsyncTaskExecutor(client, { id: 'cap1', metadata: { async: true, pollIntervalMs: 5 } });
    await expect(exec({ toolCallId: 'tc1', args: {}, signal: new AbortController().signal, ctx: {} as never }))
      .rejects.toThrow(/safety filter triggered/);
  });

  it('calls cancelTask when signal aborts mid-poll', async () => {
    const ac = new AbortController();
    const promise = exec({ ..., signal: ac.signal });
    setTimeout(() => ac.abort(), 5);
    await expect(promise).rejects.toThrow();
    expect(client.cancelTask).toHaveBeenCalledWith('t1');
  });

  it('respects asyncMaxWaitMs config (times out)', async () => {
    const client = mockClient({
      invokeCapability: { taskId: 't1' },
      getTaskSequence: new Array(50).fill({ status: 'running' }),
    });
    client.cancelTask = vi.fn().mockResolvedValue(undefined);
    const exec = createAsyncTaskExecutor(client, { id: 'cap1', metadata: { async: true, pollIntervalMs: 10, maxWaitMs: 50 } });
    await expect(exec({ toolCallId: 'tc1', args: {}, signal: new AbortController().signal, ctx: {} as never }))
      .rejects.toThrow(/exceeded 50ms/);
    expect(client.cancelTask).toHaveBeenCalledWith('t1');
  });
});
```

- [ ] **Step 2: FAIL**.

- [ ] **Step 3: Implement**

```ts
import type { CapabilityHubClient } from "./client";
import type { ToolExecuteParams, ToolResult } from "@team9claw/types";

interface CapabilityMeta {
  async?: boolean;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

interface CapabilityRow {
  id: string;
  metadata?: CapabilityMeta;
}

export function createAsyncTaskExecutor(
  client: CapabilityHubClient,
  capability: CapabilityRow,
  defaults: { pollIntervalMs?: number; maxWaitMs?: number } = {},
): (params: ToolExecuteParams) => Promise<ToolResult> {
  const pollMs =
    capability.metadata?.pollIntervalMs ?? defaults.pollIntervalMs ?? 3000;
  const maxMs = capability.metadata?.maxWaitMs ?? defaults.maxWaitMs ?? 240_000;

  return async ({ args, signal, onUpdate }) => {
    const submitted = await client.invokeCapability(capability.id, args, {
      signal,
    });
    const taskId = (submitted as { taskId?: string }).taskId;
    if (!taskId) {
      // Sync capability returned data inline; pass through unchanged
      return toToolResult(submitted);
    }
    const startedAt = Date.now();
    try {
      while (true) {
        if (signal?.aborted) throw new Error("cancelled by caller");
        if (Date.now() - startedAt > maxMs)
          throw new Error(`task ${taskId} exceeded ${maxMs}ms`);
        await sleep(pollMs, signal);
        const snap = await client.getTask(taskId, signal);
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Generating… ${elapsedSec}s (state: ${snap.status})`,
            },
          ],
        });
        if (snap.status === "completed") {
          return {
            content: [{ type: "text", text: JSON.stringify(snap.result) }],
          };
        }
        if (snap.status === "failed" || snap.status === "cancelled") {
          throw new Error(
            `task ${snap.status}: ${snap.error?.message ?? "unknown"}`,
          );
        }
      }
    } catch (err) {
      // Best-effort upstream cancel
      if (taskId) client.cancelTask(taskId).catch(() => {});
      throw err;
    }
  };
}

function toToolResult(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data),
      },
    ],
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
```

- [ ] **Step 4: PASS**.

### Task 5.3: Wire executor into Team9CapabilityHubComponent

**Files:**

- Modify: `$AP/packages/claw-hive/src/components/team9-capability-hub/component.ts`

- [ ] **Step 1: Locate the place where dynamic tools are built per capability** (search for the existing `parametersSchema → AgentTool.execute` mapper, around the `providerResolve()` area).

- [ ] **Step 2: Replace the executor selection**

```ts
// existing logic (sketch):
//   const execute = (params) => this.client.invokeCapability(cap.id, params.args, ...)
// new:
const isAsync = Boolean(cap.metadata?.async);
const execute = isAsync
  ? createAsyncTaskExecutor(this.client, cap, {
      pollIntervalMs: ctx.config.asyncPollIntervalMs,
      maxWaitMs: ctx.config.asyncMaxWaitMs,
    })
  : this.legacyInvokeExecutor(cap);
```

Keep the existing path for non-async caps unchanged.

- [ ] **Step 3: Run existing component tests**

```bash
cd $AP && pnpm test -- team9-capability-hub
```

Expected: existing PASS; new async path covered by test added in Task 5.2.

### Task 5.4: Extend config interface

**Files:**

- Modify: `$AP/packages/claw-hive-types/src/components.ts`

- [ ] **Step 1: Add fields to `Team9CapabilityHubComponentConfig`**

```ts
export interface Team9CapabilityHubComponentConfig {
  // existing fields unchanged…
  includeAsync?: boolean; // default true
  asyncPollIntervalMs?: number; // default 3000
  asyncMaxWaitMs?: number; // default 240000
}
```

- [ ] **Step 2: Update component.ts to honor `includeAsync` filter** in capability discovery.

- [ ] **Step 3: Typecheck**

```bash
cd $AP && pnpm typecheck
```

### Task 5.5: Commit Phase 5

```bash
cd $AP && git add -A && git commit -m "feat(claw-hive): async task executor for capability-hub long-running capabilities"
```

---

## Phase 6 — agent-pi: SendVideo tool

### Task 6.1: Add SendVideo to team9 tools

**Files:**

- Modify: `$AP/packages/claw-hive/src/components/team9/tools.ts`
- Modify: `$AP/packages/claw-hive/src/components/team9/tools.test.ts`

- [ ] **Step 1: Test (mirror SendImage's test)**

```ts
it("SendVideo posts video attachment to channel", async () => {
  const apiClient = mockApiClient();
  const tool = buildTeam9Tools(apiClient).find((t) => t.name === "SendVideo")!;
  const res = await tool.execute({
    args: { channelId: "c1", source: "https://x/v.mp4", caption: "hello" },
    ctx: {} as never,
    toolCallId: "tc1",
  });
  expect(apiClient.sendMessage).toHaveBeenCalledWith(
    "c1",
    expect.objectContaining({
      content: "hello",
      attachments: [expect.objectContaining({ mimeType: "video/mp4" })],
    }),
  );
  expect(res).toMatchObject({
    content: [{ type: "text", text: expect.stringContaining("success") }],
  });
});
```

- [ ] **Step 2: FAIL**.

- [ ] **Step 3: Implement** by adding the new entry to the array returned in `tools.ts` (model on the existing SendImage block at lines 437-486). Verbatim spec in § 7.1 of the design doc.

- [ ] **Step 4: PASS**.

### Task 6.2: Commit Phase 6

```bash
cd $AP && git add -A && git commit -m "feat(team9-tools): SendVideo tool mirrors SendImage with video/mp4 mimetype"
```

---

## Phase 7 — team9 client: VideoAttachment + dispatcher

### Task 7.1: VideoAttachment component

**Files:**

- Create: `$T9/apps/client/src/components/channel/VideoAttachment.tsx`

- [ ] **Step 1: Read ImageAttachment to learn the pattern**

```bash
cat $T9/apps/client/src/components/channel/MessageAttachments.tsx | sed -n '/ImageAttachment/,/^}/p' | head -80
```

- [ ] **Step 2: Implement**

```tsx
import { useFileDownloadUrl } from "@/hooks/useFileDownloadUrl";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface VideoAttachmentProps {
  attachment: {
    fileKey: string;
    fileName: string;
    mimeType: string;
    fileSize?: number;
    width?: number;
    height?: number;
  };
  className?: string;
}

export function VideoAttachment({
  attachment,
  className,
}: VideoAttachmentProps) {
  const { data: url, isLoading } = useFileDownloadUrl(attachment.fileKey);
  const aspect =
    attachment.width && attachment.height
      ? `${attachment.width} / ${attachment.height}`
      : "16 / 9";
  if (isLoading || !url) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-xs text-muted-foreground",
          className,
        )}
      >
        <Loader2 size={14} className="animate-spin" />
        Loading video…
      </div>
    );
  }
  return (
    <video
      src={url}
      controls
      preload="metadata"
      className={cn("max-w-[480px] rounded-md", className)}
      style={{ aspectRatio: aspect }}
      title={attachment.fileName}
    />
  );
}
```

(Adjust import paths to match the actual `useFileDownloadUrl` hook location and `cn` util location — verify with `grep -rn "useFileDownloadUrl" $T9/apps/client/src` first.)

### Task 7.2: Dispatch in MessageAttachments

**Files:**

- Modify: `$T9/apps/client/src/components/channel/MessageAttachments.tsx`

- [ ] **Step 1: Find the existing image/file dispatch**

```bash
grep -n "isImage\|mimeType" $T9/apps/client/src/components/channel/MessageAttachments.tsx
```

- [ ] **Step 2: Add video branch** — modify the partition logic that splits attachments into image vs file:

```tsx
const isImage = (att) => att.mimeType?.startsWith("image/");
const isVideo = (att) => att.mimeType?.startsWith("video/");

// In render:
{attachments.filter(isVideo).map((att) => <VideoAttachment key={att.fileKey} attachment={att} />)}
{attachments.filter(isImage).map(...)}
{attachments.filter((a) => !isImage(a) && !isVideo(a)).map(...)}
```

(Match the existing structure; the above is illustrative.)

- [ ] **Step 3: Manual visual smoke**

Insert a fake attachment with `mimeType: "video/mp4"` into a test channel; verify `<video>` renders.

### Task 7.3: Commit Phase 7

```bash
cd $T9 && git add -A && git commit -m "feat(client): inline video attachment renderer for video/* mimetypes"
```

---

## Phase 8 — team9 client: dashboard chip

### Task 8.1: i18n keys

**Files:**

- Modify: `$T9/apps/client/src/i18n/locales/zh-CN/navigation.json`
- Modify: `$T9/apps/client/src/i18n/locales/en-US/navigation.json`

- [ ] **Step 1: Add zh-CN keys**

```json
{
  "dashboardActionVideoGeneration": "视频生成",
  "dashboardVideoGenerationTemplate": "请帮我生成一段视频：\n- 场景：[在此描述画面、人物、动作、镜头]\n- 风格：[写实 / 卡通 / 电影感 / 留空让模型决定]\n- 时长：5 秒\n- 比例：16:9"
}
```

- [ ] **Step 2: Add en-US keys**

```json
{
  "dashboardActionVideoGeneration": "Video Generation",
  "dashboardVideoGenerationTemplate": "Please generate a short video:\n- Scene: [describe the visuals, subjects, actions, camera]\n- Style: [realistic / cartoon / cinematic / leave blank to let the model decide]\n- Duration: 5 seconds\n- Aspect: 16:9"
}
```

(Other locale files: include the same English fallback unless translations are immediately available.)

### Task 8.2: Add Video chip + insertVideoTemplate helper

**Files:**

- Modify: `$T9/apps/client/src/components/layout/contents/HomeMainContent.tsx`

- [ ] **Step 1: Import Video icon**

At the top of the file, alongside other Lucide imports:

```tsx
import { Video } from "lucide-react";
```

- [ ] **Step 2: Define `insertVideoTemplate` helper inside the component**

Inside `HomeMainContent`, after the `setPrompt` declaration:

```tsx
const promptRef = useRef<HTMLTextAreaElement | null>(null);
const insertVideoTemplate = () => {
  const tpl = t("dashboardVideoGenerationTemplate");
  setPrompt((prev) => (prev.trim() ? `${prev}\n\n${tpl}` : tpl));
  // After state flushes, focus textarea + select first [...] placeholder
  requestAnimationFrame(() => {
    const el = promptRef.current;
    if (!el) return;
    el.focus();
    const match = /\[([^\]]+)\]/.exec(el.value);
    if (match) {
      const start = match.index;
      el.setSelectionRange(start, start + match[0].length);
    }
  });
};
```

Bind `ref={promptRef}` on the existing `<Textarea>`.

- [ ] **Step 3: Populate `DASHBOARD_ACTION_CHIPS`**

Replace the empty-array initialization (line ~60):

```tsx
const DASHBOARD_ACTION_CHIPS: ReadonlyArray<{
  key: string;
  icon: typeof Video;
}> = [{ key: "dashboardActionVideoGeneration", icon: Video }];
```

- [ ] **Step 4: Wire the chip's onClick**

In the `.map` rendering chips around line 681, replace the existing logic to:

```tsx
{
  DASHBOARD_ACTION_CHIPS.map((chip) => (
    <DashboardActionChip
      key={chip.key}
      label={t(chip.key)}
      icon={chip.icon}
      onClick={() => {
        if (chip.key === "dashboardActionVideoGeneration")
          insertVideoTemplate();
      }}
    />
  ));
}
```

(Drop the deep-research-specific branches if they're commented out anyway. If the deep-research chip is intended to live alongside, restore it as a separate entry — but verify this is in scope first; it isn't part of this plan.)

- [ ] **Step 5: Verify build + manual smoke**

```bash
cd $T9 && pnpm dev:client
# In browser: dashboard → click 视频生成 chip → confirm template inserted, caret on first [..] block
```

### Task 8.3: Commit Phase 8

```bash
cd $T9 && git add -A && git commit -m "feat(dashboard): video generation chip injects prompt template into composer"
```

---

## Phase 9 — End-to-end verification

### Task 9.1: Full happy-path UAT

- [ ] **Step 1: Start all services**

```bash
# terminal 1: capability-hub
cd $CH && docker compose up -d && pnpm dev

# terminal 2: agent-pi worker + dashboard
cd $AP && pnpm dev:hive

# terminal 3: team9 server + client
cd $T9 && pnpm dev
```

- [ ] **Step 2: From dashboard, click 视频生成 chip, fill in a real prompt, send**

Expected sequence in logs:

- capability-hub: `Seedance capability registered` (at boot), then `task <id> running`, then `task <id> completed`
- agent-pi: tool_use for `seedance_generate_video`, then tool_use for `SendVideo`
- team9 server: `POST /api/messages` with attachment

- [ ] **Step 3: Verify in browser** the chat shows a `<video controls>` player that plays.

- [ ] **Step 4: Inspect `tasks` row** has `status='completed'`, `result.videoUrl`, and `tool_invocations` row exists with non-zero `upstream_cost_usd`.

### Task 9.2: Cancellation path

- [ ] **Step 1: Submit a generation, then click Stop on the agent before completion**

- [ ] **Step 2: Verify**:
- agent-pi: `cancelled by caller` error in tool_result
- capability-hub: task row `status='cancelled'`; SSE stream emitted `cancelled` event
- OpenRouter cancel attempt logged (best-effort)
- No `tool_invocations` row created (cancel = no charge per § 12 R5)

### Task 9.3: Failure path

- [ ] **Step 1: Set OPENROUTER_API_KEY to invalid temporarily; submit**

- [ ] **Step 2: Verify**:
- task `status='failed'` with `error.code='UPSTREAM_FAILED'`
- agent surface message reflects failure
- BullMQ shows the job tried 3 times before giving up

### Task 9.4: Large file edge case

- [ ] **Step 1: Pick a Seedance 10s quality output** (likely 30+ MB).

- [ ] **Step 2: Verify either**:
- Upload succeeds → renders inline; or
- Upload fails with clear "media too large" error → record file size in `team9_media.upload.size_bytes` metric (if metric not yet wired, just log).

### Task 9.5: Multi-user / multi-instance

- [ ] **Step 1: Run two capability-hub instances** (different `PORT`, same `REDIS_URL` and `DATABASE_URL`):

```bash
PORT=3001 pnpm start:dev   # window A
PORT=3002 pnpm start:dev   # window B
```

- [ ] **Step 2: Submit a task via instance A, observe SSE on instance A** while the BullMQ Worker on instance B picks it up. Both instances should report progress; UI receives events.

### Task 9.6: deep-research regression

- [ ] **Step 1: Run team9's existing deep-research smoke** (whatever the project has — `pnpm test -- deep-research` from $T9 if applicable, plus a manual deep-research session via dashboard).

- [ ] **Step 2: Verify** SSE stream shape and final report deliverable are unchanged.

### Task 9.7: Final commit + PR

- [ ] **Step 1: From each repo, push branch and open PR**

```bash
cd $CH && git push -u origin <branch>
cd $AP && git push -u origin <branch>
cd $T9 && git push -u origin <branch>
```

- [ ] **Step 2: PR descriptions cross-link** the three PRs and reference the spec doc.

- [ ] **Step 3: Update spec status header**

In `$T9/docs/superpowers/specs/2026-04-27-seedance-integration-design.md`, change `Status: Draft (awaiting user review)` to `Status: Implemented (PRs <links>)`.

- [ ] **Step 4: Commit**

```bash
cd $T9 && git add docs/superpowers/specs/2026-04-27-seedance-integration-design.md && git commit -m "docs(spec): mark seedance integration as implemented"
```
