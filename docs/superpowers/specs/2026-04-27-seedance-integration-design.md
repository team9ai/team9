# Seedance Video Generation Integration Design

- **Date:** 2026-04-27
- **Status:** Implemented (capability-hub#11, agent-pi#99, team9#84 — Draft PRs awaiting UAT)
- **Scope:** Add Bytedance Seedance 2.0 video generation as a billed capability in capability-hub; expose it to agent-pi via the existing capability-hub discovery channel; add a dashboard entry-point that injects a video-generation prompt template. As an enabling refactor, extract a generic BullMQ-backed long-task module in capability-hub and migrate the existing deep-research module onto it.
- **Repos involved:** `team9ai/capability-hub` · `team9ai/agent-pi` · `team9ai/team9` · capability-hub infra (new Redis dependency)
- **Related specs:** none

---

## Summary

Users currently have no way to generate video content from chat. We will add Seedance (via OpenRouter `bytedance/seedance-2.0` and `bytedance/seedance-2.0-fast`) as the first video-generation capability, exposed through capability-hub's existing capability registry so agent-pi auto-discovers it. The dashboard composer gets a "Video Generation" chip that injects a prompt template — no special routing, no new controller path; the user's prompt flows through the normal topic-session pipeline and the agent picks up the Seedance tool naturally.

Because video generation is asynchronous (30 s – 3 min round-trip) and capability-hub has no existing reusable long-task primitive (only the inline, single-instance, in-process scaffolding inside `deep-research`), this work also extracts a generic **BullMQ-backed Tasks Module**, then migrates `deep-research` onto it. Seedance is the first user; deep-research becomes the second.

On the agent-pi side, the existing `Team9CapabilityHubComponent` is extended (not replaced) so that capabilities marked as long-tasks are wrapped in a Job-style polling executor — re-using `JobComponent`'s polling, `HiveWait`, and `AbortSignal` plumbing. The LLM perceives a normal synchronous tool call; "generating…" progress is surfaced via the existing `onUpdate` → `tool_execution_update` channel without consuming LLM tokens.

Video bytes are persisted by re-using agent-pi's existing `loadMedia` / `uploadMediaToTeam9` / `SendVideo` flow (mirror of `SendImage`). The team9 client adds a small `VideoAttachment` renderer (mirror of `ImageAttachment`) so videos play inline. No new message type; `mimeType=video/mp4` discriminates within the existing attachment system.

---

## § 1 · System Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                            Team9 Client (Tauri)                        │
│  Dashboard composer:                                                   │
│     [+] [🎬 视频生成] [textarea] [send]                               │
│           │                                                            │
│           └── click → insert template prompt → user submits           │
└────────────────────────────────────────────────────────────────────────┘
            │ POST /api/topic-sessions
            ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Team9 Gateway / IM Worker                        │
│   Spawns a topic session, dispatches initial message to agent-pi       │
└────────────────────────────────────────────────────────────────────────┘
            │ chat protocol
            ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              agent-pi                                  │
│   - Team9CapabilityHubComponent (existing) discovers Seedance          │
│   - Tool tier surfaces seedance_generate_video to LLM                  │
│   - On tool_use → CapabilityHubTaskExecutor (new wrapper)              │
│       1. POST /api/invoke/{id}              → { taskId }              │
│       2. Poll GET /api/tasks/{id} every 3 s (JobComponent pattern)    │
│       3. onUpdate({ text: "Generating… 30 s elapsed" })                │
│       4. On completed → ToolResult(text: <video URL>)                  │
│   - LLM then invokes existing SendVideo (new) → loadMedia +            │
│     uploadMediaToTeam9 + apiClient.sendMessage(attachments)            │
└────────────────────────────────────────────────────────────────────────┘
            │ POST /api/invoke/{id}     │ POST /api/messages (with attachments)
            ▼                            ▼
┌──────────────────────────────────┐  ┌─────────────────────────────────┐
│        capability-hub             │  │  Team9 Gateway                  │
│  ┌────────────────────────────┐   │  │  - Persists message + attach.   │
│  │  TasksModule (NEW)          │   │  │  - WS broadcast new_message    │
│  │   - BullMQ queue 'tasks'    │   │  └─────────────────────────────────┘
│  │   - tasks table             │   │            │
│  │   - TaskRunnerRegistry      │   │            ▼
│  │   - SSE relay (/stream)     │   │  ┌─────────────────────────────────┐
│  └────────────────────────────┘   │  │  team9 Client                   │
│  ┌────────────────────────────┐   │  │  MessageAttachments dispatcher: │
│  │  SeedanceModule (NEW)       │   │  │   mimeType.startsWith("video/") │
│  │   - Capability registration │   │  │     → <VideoAttachment>         │
│  │   - SeedanceTaskHandler     │   │  │     → <video controls>          │
│  │     polls OpenRouter        │   │  └─────────────────────────────────┘
│  │   - Cost strategy           │   │
│  └────────────────────────────┘   │
│  ┌────────────────────────────┐   │
│  │  DeepResearchModule         │   │
│  │   (MIGRATED to TasksModule) │   │
│  └────────────────────────────┘   │
└──────────────────────────────────┘
            │ HTTPS
            ▼
┌──────────────────────────────────┐
│   OpenRouter Seedance endpoint    │
└──────────────────────────────────┘

External infra changes:
  + Redis (new) — required by BullMQ
```

---

## § 2 · Decision Log (recap of brainstorming)

| #   | Decision                                                                                                                                                                                                                                                                                        | Rationale (short)                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Build a generic `tasks/` module in capability-hub; do NOT layer Seedance directly on `proxy/`.                                                                                                                                                                                                  | Video generation is intrinsically async; reusing the synchronous `proxy/invoke` path requires either holding HTTP for minutes or hacking polling into `proxy.service.ts`. A generic module also pays back when `deep-research` is migrated. |
| D2  | Backing infra: **Redis + BullMQ** (not pg-boss / not in-process).                                                                                                                                                                                                                               | User preference. Operationally accepted to add Redis to capability-hub. BullMQ has best NestJS integration and ecosystem.                                                                                                                   |
| D3  | **Migrate `deep-research` onto the new module** in the same release.                                                                                                                                                                                                                            | Avoids leaving two long-task patterns in capability-hub.                                                                                                                                                                                    |
| D4  | agent-pi side: **client-side polling bridge** (Pattern A); LLM sees a synchronous tool call.                                                                                                                                                                                                    | Lowest LLM token cost; reuses existing `JobComponent` polling primitive (`packages/agent-components/src/components/job/job-component.ts`); does not require teaching LLM async semantics; deterministic failure modes.                      |
| D5  | Two Seedance variants exposed as **one capability** with `mode: "fast" \| "quality"` parameter, default `fast`.                                                                                                                                                                                 | Q4(b). User-facing simplicity; one capability row + one tool definition.                                                                                                                                                                    |
| D6  | Dashboard entry: **plain text template injection** into the composer textarea.                                                                                                                                                                                                                  | Q5(a). No new submit handler, no new controller; chip purely UX.                                                                                                                                                                            |
| D7  | Video result delivery: **`mimeType=video/mp4` inside existing attachments table**, durably stored in MinIO via existing `uploadMediaToTeam9`. New `VideoAttachment` client renderer; new `SendVideo` agent-pi tool (mirror of `SendImage`). NO new message type, NO DB migration on team9 side. | Q6. Maximally re-uses existing media plumbing already proven by `SendImage` / image-generation.                                                                                                                                             |
| D8  | Progress reporting: use existing `ToolExecuteParams.onUpdate` → `tool_execution_update` event.                                                                                                                                                                                                  | Visible to user UI; not fed back into LLM context (zero token cost).                                                                                                                                                                        |
| D9  | Cancellation: agent's `AbortSignal` → `POST /api/tasks/{id}/cancel` → BullMQ `removeJob` + state transition to `cancelled`. No billing on cancellation in v1 (see § 12 R5).                                                                                                                     | Cleanly propagates user "stop generation" through all layers.                                                                                                                                                                               |

---

## § 3 · capability-hub — Tasks Module (new, generic)

**Location:** `src/tasks/`

### 3.1 Responsibilities

- Provide a typed `TaskService` injectable that any capability module can use.
- Own the BullMQ queue `tasks`, its connection lifecycle, and worker registration.
- Persist task state in a new `tasks` table (replacing `research_tasks`; see § 11).
- Provide HTTP endpoints for status query, SSE event stream, and cancellation.
- Provide a `TaskRunnerRegistry` allowing handler modules (Seedance, deep-research) to register a runner keyed by `taskType`.

### 3.2 File layout

```
src/tasks/
├── tasks.module.ts                 ← imports BullModule.forRootAsync(REDIS_URL)
├── tasks.service.ts                ← submit / get / cancel / subscribe
├── tasks.controller.ts             ← GET /api/tasks/:id, GET /api/tasks?owner=…
├── task-stream.controller.ts       ← GET /api/tasks/:id/stream (SSE)
├── task-runner.registry.ts         ← register/get handlers by taskType
├── task-runner.worker.ts           ← BullMQ Worker; dispatches by registry
├── task-event.bus.ts               ← Redis pub/sub for cross-instance SSE
├── ring-buffer.ts                  ← LIFTED from deep-research
├── startup-recovery.service.ts     ← marks orphaned `running` tasks → `failed` on boot
└── dto/
    ├── submit-task.dto.ts
    └── list-tasks.dto.ts
```

### 3.3 `TaskService` API (consumer-facing)

```ts
interface TaskService {
  submit<TInput>(params: {
    taskType: string; // matches a registered runner
    capabilityId?: string;
    input: TInput;
    owner: { userId: string; tenantId: string; botId: string };
    parentTaskId?: string;
    interactionId?: string;
    bullOptions?: { priority?: number; attempts?: number };
  }): Promise<{ taskId: string }>; // returns immediately

  get(taskId: string, owner: Owner): Promise<Task | null>;

  cancel(taskId: string, owner: Owner): Promise<void>;

  // SSE-friendly async iterable; resumable via lastEventId
  stream(
    taskId: string,
    owner: Owner,
    opts?: { lastEventId?: string },
  ): AsyncIterable<TaskEvent>;
}
```

### 3.4 `TaskRunner` interface (handler-facing)

```ts
interface TaskRunner<TInput = unknown, TResult = unknown> {
  taskType: string;

  // Called by the BullMQ worker. Handler calls back into emit/done/fail.
  run(ctx: {
    taskId: string;
    input: TInput;
    emit: (event: { event?: string; data: unknown }) => Promise<void>;
    signal: AbortSignal; // aborted on cancel()
    owner: Owner;
  }): Promise<TResult>;
}
```

Registration happens in handler modules' `onModuleInit`:

```ts
this.registry.register(new SeedanceTaskHandler(this.openRouter, ...));
```

### 3.5 BullMQ configuration

- Queue name: `tasks`
- Single Redis connection shared with future modules.
- Default job options: `attempts: 3`, exponential backoff base 5 s, `removeOnComplete: { count: 1000, age: 86400 }`, `removeOnFail: { count: 1000 }`.
- Per-handler overrides via `submit({ bullOptions })`.
- `stalledInterval: 30000`, `lockDuration: 60000` — protects against worker crashes mid-task.

### 3.6 Cross-instance event delivery (multi-instance ready)

Handler emits → `TaskEventBus.publish(taskId, event)` → Redis pub/sub channel `task-events:{taskId}` → any instance's SSE controller subscribes when a client connects. Last N events also kept in Redis stream `task-stream:{taskId}` (TTL 24 h) for resumability via `last-event-id`.

### 3.7 Endpoints

| Method                       | Path                                                                                                                                                                   | Purpose |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `GET /api/tasks/:id`         | Status snapshot. Owner-scoped.                                                                                                                                         |
| `GET /api/tasks?…`           | Paginated list (filters: `taskType`, `status`, `parentTaskId`). Owner-scoped.                                                                                          |
| `GET /api/tasks/:id/stream`  | SSE; `last-event-id` supported; closes on terminal state + 5 s grace.                                                                                                  |
| `POST /api/tasks/:id/cancel` | Owner-scoped cancel. (DELETE semantics intentionally avoided — `DELETE` would imply row removal/retention, which we want to keep separate from the cancel transition.) |

`POST /api/invoke/:capabilityId` continues to exist for synchronous proxy capabilities. For async capabilities (Seedance, deep-research-task), the invoke endpoint is **not** the entry point — clients call `POST /api/tasks` directly with `taskType`. **Open question:** do we want `/api/invoke/:capabilityId` to auto-redirect to `/api/tasks` when the capability is marked async? Decision: yes, for agent-pi compatibility (so it can keep using the same client method); see § 6.

---

## § 4 · capability-hub — Seedance Module (new)

**Location:** `src/seedance/`

### 4.1 File layout

```
src/seedance/
├── seedance.module.ts
├── seedance.service.ts             ← onModuleInit: register capability + handler + cost strategy
├── seedance-task.handler.ts        ← TaskRunner; calls OpenRouter and polls
├── seedance-cost.strategy.ts
├── openrouter.client.ts            ← thin OpenRouter Seedance wrapper
└── dto/
    └── seedance-input.dto.ts
```

### 4.2 Capability registration (idempotent on startup)

```ts
{
  name: 'seedance_generate_video',
  description: 'Generate a short video from a text prompt using Bytedance Seedance.',
  type: 'tool',
  tags: ['video', 'media', 'generative', 'long-task'],
  metadata: {
    async: true,
    taskType: 'seedance.generate',
    estimatedDurationMs: 60000,
    maxDurationMs: 240000,
  },
  parametersSchema: {
    type: 'object',
    properties: {
      prompt:       { type: 'string', minLength: 1, maxLength: 1200 },
      mode:         { type: 'string', enum: ['fast', 'quality'], default: 'fast' },
      durationSec:  { type: 'integer', minimum: 3, maximum: 10, default: 5 },
      aspectRatio:  { type: 'string', enum: ['16:9','9:16','1:1','4:3','3:4'], default: '16:9' },
      seed:         { type: 'integer', nullable: true },
    },
    required: ['prompt'],
  },
}
```

### 4.3 Handler control flow

```
SeedanceTaskHandler.run({ taskId, input, emit, signal, owner })
 ├─ emit({ event: 'started', data: { ... } })
 ├─ const submitRes = await openrouter.submitVideoJob({
 │     model: input.mode === 'quality' ? 'bytedance/seedance-2.0' : 'bytedance/seedance-2.0-fast',
 │     prompt, durationSec, aspectRatio, seed, signal,
 │   })
 ├─ Loop until terminal:
 │    pollState = await openrouter.getJobState(submitRes.jobId, { signal })
 │    emit({ event: 'progress', data: { state, elapsedMs } })
 │    sleep(min(8s, exponentialBackoff))
 ├─ if terminal === 'completed':
 │    return { videoUrl, mimeType, durationSec, sizeBytes? }
 ├─ if terminal === 'failed':
 │    throw TaskError({ code: 'UPSTREAM_FAILED', message, retriable: …})
 └─ on signal aborted: openrouter.cancelJob(jobId).catch(() => {}) ; throw new AbortError()
```

### 4.4 Cost strategy

- Read OpenRouter's response cost field (`generation_cost_usd`) when present.
- Fallback to a static table keyed by `(model, durationSec)` in `seedance-cost.strategy.ts`.
- Billing emitted on **completed** only. Failures and cancellations: no charge in v1.
- Records into `tool_invocations` + `billing_outbox` (existing tables) on completion.

### 4.5 OpenRouter contract (to verify in implementation)

OpenRouter's video models follow the `/api/v1/generation` async pattern. The wrapper code MUST:

- Treat `submit` and `poll` as idempotent on best-effort.
- Persist `submitRes.jobId` into the task's `metadata.upstreamJobId` so cancel and resume are possible.
- Not log the API key.

**Risk:** if OpenRouter changes Seedance to a streaming-completion shape, the handler simplifies — but the public capability contract does not change.

---

## § 5 · capability-hub — `deep-research` Migration

**Goal:** route deep-research through the new TasksModule without breaking the existing client (team9 calls `POST /deep-research/tasks` and consumes `GET /deep-research/tasks/:id/stream`).

### 5.1 Approach

- **Keep** the public `POST/GET /deep-research/tasks*` endpoints unchanged (URL contract preserved). Internally these become thin façades over `TaskService`.
- **Replace** the in-process `task-runner.service.ts` (`Map<string, RunnerHandle>`) with a `DeepResearchTaskHandler` registered on `TaskRunnerRegistry`.
- **Drop** the in-memory subscriber pattern; SSE events come through the generic event bus (Redis pub/sub).
- **Drop** the bespoke `startup-recovery.service.ts` (subsumed by the generic one).

### 5.2 Schema migration

The existing `research_tasks` table is replaced by the generic `tasks` table (§ 11). Migration:

1. Create the new `tasks` table.
2. Copy existing `research_tasks` rows into `tasks` with `task_type='deep_research'`. Map `final_report_s3` and `events_archive_s3` into `result_meta` JSONB.
3. Update `deep-research.service.ts` to write/read from `tasks`.
4. After one release of dual-write (one week), drop `research_tasks`.

This dual-write window protects against rollback. **Open question:** is one week sufficient? Depends on rollback policy.

### 5.3 Behaviour-preserving constraints

- The `deep-research` SSE event sequence (`event:` names, `data:` payload shape) MUST be identical pre/post-migration.
- `interactionId` uniqueness, `parent_task_id` cascade, `tools_config` and `store_refs` columns all preserved as task-typed metadata.
- Billing path through `DeepResearchBillingService` remains; it just gets called from the new handler instead of the old runner.

---

## § 6 · agent-pi — Capability-Hub Task Wrapper

**Location:** `packages/claw-hive/src/components/team9-capability-hub/`

### 6.1 Approach

Extend, don't replace. The existing `Team9CapabilityHubComponent` already:

- Discovers capabilities via `client.discoverCapabilities()`.
- Builds dynamic tools from each capability's `parametersSchema`.
- Registers each tool with the tool-tier system.

The new behavior: when building the tool's `execute` function, **inspect `capability.metadata.async`**. If `true`, wrap the execute in a polling loop using `JobComponent`'s pattern; otherwise keep the current synchronous invoke path.

### 6.2 New file

```
packages/claw-hive/src/components/team9-capability-hub/
├── client.ts                       (existing; minor additions)
├── component.ts                    (existing; modified to choose executor)
└── async-task-executor.ts          (NEW; ~120 LoC)
```

`async-task-executor.ts` exports a factory `createAsyncTaskExecutor(client, capability, opts)` returning the `execute` function fed into `AgentTool`. Internally it:

1. Calls `client.invokeCapability(capabilityId, args)` — which the client now handles by POSTing to `/api/invoke/:id` (same URL as before; capability-hub recognizes async caps and creates a task, returning `{taskId}`). This is the auto-redirect from § 3.7.
2. Polls `client.getTask(taskId)` every `pollIntervalMs` (default 3 000, override per capability via `metadata.pollIntervalMs`).
3. On each poll, calls `onUpdate({ content: [{ type: 'text', text: `Generating… ${elapsedSec}s` }] })`. This emits `tool_execution_update` for the UI; LLM context unaffected.
4. On terminal `completed`: returns `{ content: [{ type: 'text', text: JSON.stringify(task.result) }] }`. (LLM sees the JSON; if `result.videoUrl` present it can pass it to `SendVideo`.)
5. On `failed` / `cancelled`: throws an Error so the agent loop marks the tool result `isError: true`.
6. On `signal.aborted`: calls `client.cancelTask(taskId).catch(() => {})` before re-throwing.

### 6.3 Re-use rather than rebuild

- **`JobComponent`** at `packages/agent-components/src/components/job/job-component.ts` already implements `setInterval` polling, `HiveWait`, and `signal` cancellation. The async-task-executor either:
  - **Option A (preferred):** lifts the polling pattern (~30 LoC) inline. Lower coupling; we don't try to fit Seedance into JobComponent's job-id/status semantics.
  - **Option B:** instantiates a `JobComponent` internally per capability invocation. Higher coupling; risks dragging in unrelated JobComponent semantics (Hive notifications, etc.).
  - **Decision:** Option A. Mirror the polling shape, don't depend on the class.
- **`AbortSignal`** — already passed through `ToolExecuteParams.signal`, propagated via standard fetch.
- **`onUpdate`** — already wired to `tool_execution_update` events in `agent-session.ts:822-830`.
- **`CapabilityHubClient`** — extend with `getTask(id)`, `cancelTask(id)` methods. ~20 LoC each.

### 6.4 Discovery filter

Async capabilities should be filterable. The component config gains:

```ts
interface Team9CapabilityHubComponentConfig {
  // existing…
  includeAsync?: boolean; // default true
  asyncPollIntervalMs?: number; // default 3000
  asyncMaxWaitMs?: number; // default 240000 (4 min)
}
```

If a session blueprint wants only sync capabilities (e.g., low-latency agents), it sets `includeAsync: false`.

---

## § 7 · agent-pi — `SendVideo` Tool

**Location:** `packages/claw-hive/src/components/team9/tools.ts` (mirror of `SendImage`)

### 7.1 Tool definition

```ts
{
  name: 'SendVideo',
  description:
    'Send a video to a channel. ' +
    'Source can be (a) http(s):// URL — typical for URLs returned by ' +
    'seedance_generate_video; (b) local file path. ' +
    'The video is downloaded, persisted to team9 storage, and posted as an ' +
    'attachment with mimeType=video/mp4.',
  parameters: {
    type: 'object',
    properties: {
      channelId: { type: 'string' },
      source:    { type: 'string', description: 'http(s):// URL or local path' },
      caption:   { type: 'string' },
      parentId:  { type: 'string' },
    },
    required: ['channelId', 'source'],
  },
  execute: async ({ args }) => {
    const media = await loadMedia(source);
    const attachment = await uploadMediaToTeam9(apiClient, {
      buffer: media.buffer,
      fileName: media.fileName,
      contentType: media.contentType,
    });
    const sendResult = await apiClient.sendMessage(channelId, {
      content: caption ?? '',
      parentId,
      attachments: [attachment],
    });
    return toToolResult({ success: true, ...sendResult });
  },
}
```

### 7.2 Constants to revisit

- `MAX_UPLOAD_BYTES = 50 * 1024 * 1024` in `team9-media.ts` may be too small for longer Seedance outputs. **Action:** before raising, measure: a 5-second 1080p MP4 from Seedance ≈ 4–10 MB; fast-mode shorter clips will be smaller. **Decision:** keep 50 MB; if user reports failures, raise to 100 MB and instrument.
- `FETCH_TIMEOUT_MS = 30_000` is the download timeout from the source URL. OpenRouter-hosted videos are typically fast; keep 30 s.

### 7.3 Tool not added to LLM directly via "load"; surfaces via team9 component

`SendVideo` lives in the team9 component's tool list, registered the same way as `SendImage`. No changes to blueprints needed; presets that include the team9 component automatically get `SendVideo`.

---

## § 8 · team9 — Dashboard Chip + Video Renderer

### 8.1 Dashboard composer chip

**Location:** `apps/client/src/components/layout/contents/HomeMainContent.tsx`

The existing `DASHBOARD_ACTION_CHIPS` array is empty; a single `Video Generation` chip is added. Following the pattern of the (currently commented-out) Deep Research chip:

```ts
const DASHBOARD_ACTION_CHIPS: ChipDef[] = [
  {
    key: "dashboardActionVideoGeneration",
    icon: Video,
    onClick: () => insertVideoTemplate(),
  },
];
```

Where `insertVideoTemplate` does, in order:

1. Read current `prompt` value.
2. Compute `next = prompt.trim().length === 0 ? TEMPLATE : prompt + '\n\n' + TEMPLATE`.
3. `setPrompt(next)`; focus textarea; place caret inside the first `[…]` placeholder.
4. **No state toggle, no submit-handler branch.** Default `createTopicSession.mutateAsync()` path is used unchanged — the agent picks Seedance up via capability discovery.

### 8.2 Template prompt copy

```
请帮我生成一段视频：
- 场景：[在此描述画面、人物、动作、镜头]
- 风格：[写实 / 卡通 / 电影感 / 留空让模型决定]
- 时长：5 秒
- 比例：16:9
```

The template is intentionally explicit so the LLM picks the Seedance tool with high probability. Stored as an i18n key `dashboardVideoGenerationTemplate` so future copy tweaks don't need code changes. Template does **not** name the tool by ID (`seedance_generate_video`) — relying on capability description + tags to drive selection keeps the dashboard decoupled from capability naming.

### 8.3 i18n keys (added)

| Key                                | zh-CN       | en-US              |
| ---------------------------------- | ----------- | ------------------ |
| `dashboardActionVideoGeneration`   | 视频生成    | Video Generation   |
| `dashboardVideoGenerationTemplate` | (per § 8.2) | English equivalent |

### 8.4 `VideoAttachment` component

**Location:** `apps/client/src/components/channel/VideoAttachment.tsx` (new)

Mirror of `ImageAttachment`. Differences:

- Renders `<video controls preload="metadata">` instead of `<img>`.
- Aspect-ratio derived from attachment `width`/`height` if present; else 16:9 with `max-width: 480px`.
- Uses the same `useFileDownloadUrl(fileKey)` hook (presigned URL, 7 h client cache).
- No lightbox in v1 (HTML5 native fullscreen via the `<video>` controls is enough).

### 8.5 Dispatch in `MessageAttachments.tsx`

Existing logic:

```ts
const isImage = att.mimeType?.startsWith("image/");
```

Updated:

```ts
const isImage = att.mimeType?.startsWith("image/");
const isVideo = att.mimeType?.startsWith("video/");
// → render VideoAttachment when isVideo, else existing ImageAttachment / FileAttachment paths.
```

If the renderer is unavailable (older client version), the user sees a `FileAttachment` download link — graceful degradation, no broken state.

---

## § 9 · End-to-End Data Flow

```
1.  User clicks 🎬 chip          → textarea gets template, caret in [scene] block
2.  User edits prompt, presses Send
3.  team9 client → POST /api/topic-sessions {initialMessage}
4.  team9 gateway creates channel, inserts user message, dispatches to agent-pi via existing topic-session pipeline
5.  agent-pi opens session; Team9CapabilityHubComponent already discovered seedance_generate_video at startup
6.  LLM emits tool_use(seedance_generate_video, {prompt, mode:"fast", durationSec:5, aspectRatio:"16:9"})
7.  async-task-executor:
       a. POST capability-hub /api/invoke/{seedanceId} → 202 {taskId}  (auto-redirect to TaskService.submit)
       b. Polls /api/tasks/{taskId} every 3s; on each poll calls onUpdate(progress)
8.  capability-hub TaskRunnerWorker picks job from BullMQ → SeedanceTaskHandler.run
       a. submits to OpenRouter Seedance
       b. polls OpenRouter every ~5s
       c. emits 'progress' events to TaskEventBus (Redis pub/sub)
       d. on completed → returns { videoUrl, mimeType, durationSec, sizeBytes }
       e. records billing (cost strategy) into tool_invocations + billing_outbox
       f. tasks.status = 'completed', tasks.result = {...}
9.  async-task-executor receives completed → returns ToolResult(text=JSON of result)
10. LLM sees the tool_result with videoUrl → emits tool_use(SendVideo, {channelId, source: videoUrl, caption: "..."})
11. SendVideo: loadMedia(videoUrl) → downloads from OpenRouter (≤30s) → uploadMediaToTeam9
12. team9 gateway createPresignedUpload → uploaded to MinIO → confirmUpload → returns {fileKey, ...}
13. SendVideo: apiClient.sendMessage(channelId, {content, attachments:[{fileKey, mimeType:"video/mp4", ...}]})
14. team9 gateway persists message + message_attachments row → WS broadcasts new_message
15. team9 client receives new_message → MessageAttachments dispatches mimeType=video/* → <VideoAttachment>
16. <VideoAttachment> calls useFileDownloadUrl(fileKey) → presigned URL → <video controls> renders, ready to play
```

Cancellation path (any step from 7 onward):

- User aborts agent → AgentSession.abort() → AbortController.abort()
- Tool execute receives signal.aborted
- async-task-executor: client.cancelTask(taskId)
- capability-hub TaskService.cancel: BullMQ removeJob + handler.signal.abort + status=cancelled + emit 'cancelled' SSE event
- SeedanceTaskHandler: openrouter.cancelJob(upstreamJobId).catch(noop) ; throw AbortError

---

## § 10 · API Contracts

### 10.1 capability-hub (new and modified endpoints)

```
POST   /api/tasks                              { taskType, input, capabilityId?, parentTaskId?, ... }
                                               → 202 { taskId }
GET    /api/tasks/:id                          → { id, status, taskType, input, result?, error?, createdAt, completedAt? }
GET    /api/tasks?taskType=&status=&page=...   → { items, page, hasMore }
GET    /api/tasks/:id/stream                   → text/event-stream
POST   /api/tasks/:id/cancel                   → 200 { ...status snapshot }

POST   /api/invoke/:capabilityId               (existing) — for sync caps unchanged.
                                               for async caps: internally calls TaskService.submit
                                               and returns 202 { taskId } (BREAKING for any
                                               existing client that called an async cap and
                                               expected synchronous result; no such clients exist
                                               today since deep-research is on its own URL).
```

Auth: existing `x-service-key` header + `x-user-id` / `x-tenant-id` / `x-bot-id`. Owner-scoping enforced on every endpoint.

### 10.2 agent-pi capability-hub client additions

```ts
class CapabilityHubClient {
  // existing
  invokeCapability(
    id,
    args,
    opts?,
  ): Promise<InvocationResult | { taskId: string }>;
  // new
  getTask(taskId, signal?): Promise<TaskSnapshot>;
  cancelTask(taskId, signal?): Promise<void>;
  // optionally — only if SSE bridge wins later
  // streamTask(taskId, signal?): AsyncIterable<TaskEvent>
}
```

### 10.3 SSE event shape

```
id: <monotonic seq>
event: started | progress | completed | failed | cancelled | log
data: <JSON>
```

`progress` payload schema is handler-defined; consumers MUST accept extra fields. Consumers MUST tolerate an empty `event:` line (treated as default `message`).

---

## § 11 · Database Schema Changes

### 11.1 capability-hub: new `tasks` table

```ts
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
    taskType: varchar("task_type", { length: 64 }).notNull(), // 'seedance.generate' | 'deep_research' | …
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
    result: jsonb("result"), // handler-defined; e.g. { videoUrl, ... }
    resultMeta: jsonb("result_meta"), // legacy fields for migrated deep_research (final_report_s3, events_archive_s3)
    toolsConfig: jsonb("tools_config").notNull().default([]), // for deep_research
    storeRefs: text("store_refs").array().notNull().default([]), // for deep_research
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

Note: `tools_config` and `store_refs` are kept on the generic table to ease deep-research migration. Other handlers may leave them at default. **Open question:** should we instead carry these in `input`/`result_meta` and drop the top-level columns? Decision: keep them in v1 to minimise migration risk; revisit after one quarter.

### 11.2 capability-hub: `research_tasks` migration

Per § 5.2: dual-write for one release window, then drop.

### 11.3 team9: no schema changes

`messages.type` enum unchanged. `message_attachments.mimeType` already accepts arbitrary strings. `video/mp4` requires no DDL.

---

## § 12 · Risks & Open Questions

| #   | Risk / Question                                                                                                            | Resolution / Watchpoint                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Seedance video size > 50 MB hits agent-pi `MAX_UPLOAD_BYTES`.                                                              | Measure on first integrations; raise to 100 MB if observed. Add metric: `team9_media.upload.size_bytes`.                                                  |
| R2  | OpenRouter rate-limits / 429 during peak.                                                                                  | BullMQ `attempts: 3` with exponential backoff handles transient. Monitor `tasks.failed` rate.                                                             |
| R3  | BullMQ worker crash mid-task → stuck `running` row.                                                                        | `stalledInterval: 30 s` + `lockDuration: 60 s` + `startup-recovery.service` marks orphans `failed`. Worker version bump invalidates locks safely.         |
| R4  | Multi-instance SSE: client connects to instance A, task runs on instance B.                                                | Resolved by `task-event.bus` Redis pub/sub. Tested via integration test with two worker instances.                                                        |
| R5  | Cancellation billing — should a cancelled task 30 s in still incur cost?                                                   | v1: **no charge on cancel**. Rationale: simpler UX; OpenRouter usage refund logic is fragile. Accept the small revenue loss; revisit if abused.           |
| R6  | Cancellation upstream — OpenRouter may not support `cancelJob` for Seedance.                                               | Best-effort cancel on our side. Upstream may still bill us — we eat the cost in v1. Track in `seedance.cancel.upstream_failure` metric.                   |
| R7  | LLM emits Seedance prompt but forgets to call SendVideo.                                                                   | Add a sentence to the seedance capability `description`: _"After successful generation, call SendVideo with the returned URL to deliver to the channel."_ |
| R8  | LLM picks Seedance for image-only requests.                                                                                | Capability `description` is precise: "\*Generate a short **video\***". Plus `tags: ['video']` is searchable. Acceptable risk.                             |
| R9  | Deep-research migration breaks existing dashboard polling client.                                                          | Keep `POST/GET /deep-research/tasks*` URLs identical. SSE event shape contract preserved by integration test.                                             |
| R10 | Redis is a new SPOF for capability-hub.                                                                                    | Same SPOF profile as Postgres. Use managed Redis (e.g. ElastiCache or Railway add-on). Document in CLAUDE.md.                                             |
| R11 | The async-task-executor blocks the agent loop tool slot for up to 4 minutes.                                               | Acceptable: agent-pi already supports concurrent tool calls; LLM continues other tools meanwhile. AbortSignal cancels cleanly.                            |
| Q1  | (resolved in spec) Cancel endpoint chosen: `POST /api/tasks/:id/cancel`. DELETE reserved for future row-removal semantics. | —                                                                                                                                                         |
| Q2  | `tools_config` / `store_refs` live on generic table or in `input`/`result_meta`?                                           | v1: keep top-level columns to minimise deep-research migration risk.                                                                                      |
| Q3  | One-week dual-write for `research_tasks` vs longer?                                                                        | One week is the default; can extend at cutover time.                                                                                                      |
| Q4  | Polling interval for async-task-executor: 3 s default — adjustable per-capability via `metadata.pollIntervalMs`?           | Yes; document on the capability schema.                                                                                                                   |

---

## § 13 · Implementation Phases & Estimate

Day numbers are working-day estimates by a single engineer.

| Phase | Day     | Description                                                                                                                                                 | Done-when                                                                                              |
| ----- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| P1    | 0.5     | capability-hub: add Redis dep, BullModule wiring, env config, docker-compose update.                                                                        | `pnpm dev` boots with Redis healthy; smoke test enqueue/dequeue noop job.                              |
| P2    | 2.0     | capability-hub: `tasks/` module (service, controller, registry, worker, event bus, schema, recovery). Unit tests + multi-instance integration test.         | `POST /api/tasks` + `GET /:id/stream` work end-to-end with a test handler.                             |
| P3    | 1.5     | capability-hub: `seedance/` module — capability registration, OpenRouter wrapper, handler, cost strategy. Unit tests + one e2e with OpenRouter sandbox key. | A test invocation produces a real Seedance video URL.                                                  |
| P4    | 1.5     | capability-hub: deep-research migration onto `tasks/`. Dual-write window. Contract tests against existing `/deep-research/tasks*` SSE shape.                | Existing dashboard deep-research flow works unmodified.                                                |
| P5    | 1.0     | agent-pi: `async-task-executor.ts`, `Team9CapabilityHubComponent` extension, `CapabilityHubClient.getTask/cancelTask`. Tests with mocked task lifecycle.    | Existing capability-hub-tools integration tests pass + new tests for async path.                       |
| P6    | 0.3     | agent-pi: `SendVideo` tool added to team9 component.                                                                                                        | Unit test sends a real video file to a test channel.                                                   |
| P7    | 0.4     | team9 client: `VideoAttachment` component, `MessageAttachments` dispatcher update.                                                                          | Manual test: post a message with `video/mp4` attachment renders inline player.                         |
| P8    | 0.4     | team9 client: dashboard chip, i18n, template injection logic.                                                                                               | Click chip, see template inserted with caret in placeholder; submit flows to a topic session normally. |
| P9    | 1.4     | E2E: full chain. Manual UAT: prompt → video plays in chat. Edge cases: cancel, failure, large file, parallel agents.                                        | UAT sign-off.                                                                                          |
|       | **9.0** | **Total**                                                                                                                                                   |                                                                                                        |

Phase ordering rationale: P1–P3 unblock Seedance backend independently; P4 (deep-research migration) is parallelisable with P5–P8. P9 requires all earlier phases.

---

## § 14 · Out of Scope (Explicit Non-Goals)

The following are explicitly **NOT** part of this work to keep scope tight:

- ❌ Other video models (Runway, Pika, Luma) — Seedance only.
- ❌ Image-to-video / video-to-video — text-to-video only.
- ❌ A user-facing "video task history" page — query API exists, UI does not.
- ❌ Webhook-based out-of-band video delivery (Pattern C in brainstorming).
- ❌ A new `video` message type in team9.
- ❌ Lightbox / fullscreen overlay for `<video>` (HTML5 native controls suffice).
- ❌ Server-side thumbnail extraction (would need ffmpeg in capability-hub).
- ❌ Refund / partial billing on cancellation — flat "no charge if cancelled or failed" in v1.
- ❌ Per-tenant quota for video generation — relies on existing global cost-strategy / billing-outbox limits for now.
- ❌ Streaming partial video frames — Seedance is a complete-or-nothing model.

These should be tracked as follow-up work if the v1 ships and adoption justifies it.
