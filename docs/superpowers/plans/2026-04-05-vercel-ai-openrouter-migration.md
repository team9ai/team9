# Vercel AI SDK + OpenRouter Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `AiClientService` calls in `CommonStaffService` with Vercel AI SDK (`streamText` / `streamObject`) + OpenRouter, eliminating fragile JSON-line parsing.

**Architecture:** The service switches from `AiClientService.chat()` (Anthropic SDK wrapper) to Vercel AI SDK's `streamText()` for persona generation and `streamObject()` + Zod schema for candidate generation. OpenRouter acts as model router via `@ai-sdk/openai`'s `createOpenAI` pointed at `https://openrouter.ai/api/v1`. Controller SSE pattern is unchanged; frontend candidate consumer is updated to handle progressive partial objects.

**Tech Stack:** `ai` (Vercel AI SDK), `@ai-sdk/openai`, `zod`, NestJS, Jest 30 + ts-jest (ESM)

**Spec:** `docs/superpowers/specs/2026-04-05-vercel-ai-openrouter-migration-design.md`

---

## File Structure

| File                                                                     | Action                | Responsibility                                                    |
| ------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------- |
| `apps/server/apps/gateway/src/applications/common-staff.service.ts`      | Modify                | Replace AI calls with streamText/streamObject                     |
| `apps/server/apps/gateway/src/applications/common-staff.service.spec.ts` | Modify                | Update mocks from aiClientService.chat to streamText/streamObject |
| `apps/client/src/services/api/applications.ts`                           | Modify                | Update generateCandidates return type for partial events          |
| `apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx`        | Modify                | Update handleGenerateCandidates to consume partial objects        |
| `apps/server/package.json`                                               | Modify (via pnpm add) | Add ai, @ai-sdk/openai, zod deps                                  |

---

### Note: .env.example

`OPENROUTER_API_KEY` already exists in `apps/server/.env.example` (line 34). No changes needed.

---

### Task 0: Branch Setup and Dependencies

**Goal:** Create feature branch off `dev` and install required packages.

**Files:**

- Modify: `apps/server/package.json` (via pnpm add)

**Acceptance Criteria:**

- [ ] Branch `feat/vercel-ai-openrouter-migration` exists off `dev`
- [ ] `ai`, `@ai-sdk/openai`, `zod` are in `apps/server/package.json` dependencies
- [ ] `pnpm install` succeeds with no errors

**Verify:** `cd apps/server && node -e "require('ai'); require('@ai-sdk/openai'); require('zod'); console.log('OK')"` → `OK`

**Steps:**

- [ ] **Step 1: Create branch off dev**

```bash
git checkout dev && git pull
git checkout -b feat/vercel-ai-openrouter-migration
```

- [ ] **Step 2: Install dependencies**

```bash
cd apps/server && pnpm add ai @ai-sdk/openai zod
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/package.json apps/server/pnpm-lock.yaml pnpm-lock.yaml
git commit -m "chore: add ai, @ai-sdk/openai, zod dependencies for common-staff migration"
```

---

### Task 1: Migrate generatePersona to streamText

**Goal:** Replace `aiClientService.chat()` in `generatePersona()` with Vercel AI SDK's `streamText()`, update tests.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts:1-18,493-580`
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.spec.ts:1-10,166-171,225-229,970-1188`

**Acceptance Criteria:**

- [ ] `generatePersona()` uses `streamText()` from `ai` package with OpenRouter provider
- [ ] Model is `anthropic/claude-sonnet-4-6`
- [ ] Temperature 0.9, maxTokens 1024 preserved
- [ ] System prompt passed via `system` param (not in messages array)
- [ ] All existing persona tests pass with updated mocks
- [ ] No references to `aiClientService` in persona-related code paths

**Verify:** `cd apps/server && npx jest --config apps/gateway/jest.config.cjs --testPathPattern common-staff.service.spec -- --verbose 2>&1 | tail -30` → all generatePersona tests PASS

**Steps:**

- [ ] **Step 1: Add ai module mock to the test file**

At the top of `common-staff.service.spec.ts`, after the `@jest/globals` import (line 1), add the `jest.mock('ai')` call and import the mocked functions:

```typescript
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

jest.mock("ai", () => ({
  streamText: jest.fn(),
  streamObject: jest.fn(),
}));

import { streamText, streamObject } from "ai";
```

- [ ] **Step 2: Update the test helper for streamText**

Replace the `makeChunkGenerator` helper (lines 166-171) with a version that returns the shape `streamText` produces:

```typescript
/** Creates an async iterable that yields the given strings */
function makeAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) return { value: items[i++], done: false };
          return { value: undefined as any, done: true };
        },
      };
    },
  };
}

/** Builds a mock return value for streamText */
function mockStreamTextReturn(chunks: string[]) {
  return { textStream: makeAsyncIterable(chunks) };
}
```

- [ ] **Step 3: Remove aiClientService mock default for chat, replace with streamText**

In `beforeEach` (around line 225-229), remove the `aiClientService` variable and its mock. Replace the default mock setup:

Remove:

```typescript
aiClientService = {
  chat: jest.fn<any>().mockReturnValue(makeChunkGenerator(["Hello", " world"])),
};
```

Add before the TestingModule creation:

```typescript
(streamText as jest.Mock).mockReturnValue(
  mockStreamTextReturn(["Hello", " world"]),
);
(streamObject as jest.Mock).mockReturnValue({
  partialObjectStream: makeAsyncIterable([]),
  object: Promise.resolve({ candidates: [] }),
});
```

Also remove `{ provide: AiClientService, useValue: aiClientService }` from the TestingModule providers (line 242). Keep the `AiClientService` import at the top for now — it is still used by the module DI but Task 3 will clean it up.

- [ ] **Step 4: Update generatePersona tests**

In the `describe('generatePersona')` block (lines 972-1188), update all `aiClientService.chat` references:

Replace every `aiClientService.chat.mockReturnValueOnce(...)` with the streamText mock pattern:

```typescript
(streamText as jest.Mock).mockReturnValueOnce(
  mockStreamTextReturn(["chunk1", "chunk2", "chunk3"]),
);
```

Replace call assertions like `expect(aiClientService.chat).toHaveBeenCalledWith(...)` with:

```typescript
expect(streamText).toHaveBeenCalledWith(
  expect.objectContaining({
    temperature: 0.9,
    maxTokens: 1024,
  }),
);
```

For tests checking prompt content, access the mock call args:

```typescript
const callArg = (streamText as jest.Mock).mock.calls[0][0] as {
  system: string;
  messages: { role: string; content: string }[];
};
const userMessage = callArg.messages.find((m) => m.role === "user");
expect(userMessage?.content).toContain("Jordan");
```

For the "uses claude provider" test, replace the provider/stream assertion with:

```typescript
expect(streamText).toHaveBeenCalledWith(
  expect.objectContaining({
    temperature: 0.9,
    maxTokens: 1024,
  }),
);
// Verify model is called (openrouter returns a model object)
const callArg = (streamText as jest.Mock).mock.calls[0][0];
expect(callArg.model).toBeDefined();
```

For the error propagation test, create an error-throwing async iterable:

```typescript
function makeErrorIterable(): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let yielded = false;
      return {
        async next() {
          if (!yielded) {
            yielded = true;
            return { value: "start", done: false };
          }
          throw new Error("AI provider error");
        },
      };
    },
  };
}
(streamText as jest.Mock).mockReturnValueOnce({
  textStream: makeErrorIterable(),
});
```

For the "empty stream" test:

```typescript
(streamText as jest.Mock).mockReturnValueOnce(mockStreamTextReturn([]));
```

- [ ] **Step 5: Update the service — generatePersona method**

In `common-staff.service.ts`, update the imports at the top (lines 1-18). Add:

```typescript
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
```

Add the OpenRouter provider as a module-level constant after the imports:

```typescript
const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
```

In `generatePersona()` (lines 565-579), replace:

```typescript
const stream = this.aiClientService.chat({
  provider: AIProvider.CLAUDE,
  model: "claude-3-5-haiku-20241022",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ],
  temperature: 0.9,
  maxTokens: 1024,
  stream: true,
});

for await (const chunk of stream) {
  yield chunk;
}
```

With:

```typescript
const result = streamText({
  model: openrouter("anthropic/claude-sonnet-4-6"),
  system: systemPrompt,
  messages: [{ role: "user", content: userMessage }],
  temperature: 0.9,
  maxTokens: 1024,
});

for await (const chunk of result.textStream) {
  yield chunk;
}
```

- [ ] **Step 6: Run persona tests**

```bash
cd apps/server && npx jest --config apps/gateway/jest.config.cjs --testPathPattern common-staff.service.spec -- --verbose 2>&1 | grep -E "PASS|FAIL|generatePersona"
```

Expected: all generatePersona tests PASS. Fix any failures before proceeding.

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/applications/common-staff.service.ts \
       apps/server/apps/gateway/src/applications/common-staff.service.spec.ts
git commit -m "refactor: migrate generatePersona to Vercel AI SDK streamText + OpenRouter"
```

---

### Task 2: Migrate generateCandidates to streamObject

**Goal:** Replace `aiClientService.chat()` + manual JSON-line parsing in `generateCandidates()` with `streamObject()` + Zod schema, update tests.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts:634-711`
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.spec.ts:1270-1492`

**Acceptance Criteria:**

- [ ] `generateCandidates()` uses `streamObject()` with a Zod schema
- [ ] Return type is `AsyncGenerator<{ type: 'partial' | 'complete'; data: unknown }>`
- [ ] No manual JSON buffer/line parsing remains
- [ ] Zod schema enforces `candidates` array with `candidateIndex`, `displayName`, `roleTitle`, `persona`, `summary`
- [ ] All candidate tests pass with updated mocks

**Verify:** `cd apps/server && npx jest --config apps/gateway/jest.config.cjs --testPathPattern common-staff.service.spec -- --verbose 2>&1 | tail -30` → all generateCandidates tests PASS

**Steps:**

- [ ] **Step 1: Add Zod schema to the service**

In `common-staff.service.ts`, add the zod import at the top:

```typescript
import { z } from "zod";
```

Add the candidate schema as a module-level constant (after the `openrouter` declaration):

```typescript
const candidateSchema = z.object({
  candidates: z.array(
    z.object({
      candidateIndex: z.number(),
      displayName: z.string(),
      roleTitle: z.string(),
      persona: z.string(),
      summary: z.string(),
    }),
  ),
});
```

- [ ] **Step 2: Rewrite generateCandidates in the service**

Replace the entire `generateCandidates` method body (lines 634-711) with:

```typescript
async *generateCandidates(
  appId: string,
  tenantId: string,
  dto: GenerateCandidatesDto,
): AsyncGenerator<{ type: 'partial' | 'complete'; data: unknown }> {
  // Verify app is common-staff type
  const app = await this.installedApplicationsService.findById(
    appId,
    tenantId,
  );
  if (!app || app.applicationId !== COMMON_STAFF_APPLICATION_ID) {
    throw new BadRequestException('Not a common-staff application');
  }

  // Build prompt parts
  const promptParts: string[] = [
    'Generate exactly 3 diverse AI employee candidate profiles.',
    'Each candidate should be unique and interesting with distinct personality traits.',
    'The persona should be personality-rich: include character traits, communication style, work habits, and quirks.',
    'Each summary should be 1-2 sentences capturing the candidate\'s essence.',
  ];

  if (dto.jobTitle) promptParts.push(`Job Title: ${dto.jobTitle}`);
  if (dto.jobDescription)
    promptParts.push(`Job Description: ${dto.jobDescription}`);

  const result = streamObject({
    model: openrouter('anthropic/claude-sonnet-4-6'),
    schema: candidateSchema,
    prompt: promptParts.join('\n'),
    temperature: 0.95,
  });

  for await (const partial of result.partialObjectStream) {
    yield { type: 'partial' as const, data: partial };
  }

  const final = await result.object;
  yield { type: 'complete' as const, data: final };
}
```

Also add `streamObject` to the existing `import { streamText } from 'ai'`:

```typescript
import { streamText, streamObject } from "ai";
```

- [ ] **Step 3: Update generateCandidates tests**

In `common-staff.service.spec.ts`, rewrite the `describe('generateCandidates')` block (lines 1272-1492).

Add a helper to build `streamObject` mock returns:

```typescript
/** Builds a mock return value for streamObject */
function mockStreamObjectReturn(partials: unknown[], finalObj: unknown) {
  return {
    partialObjectStream: makeAsyncIterable(partials),
    object: Promise.resolve(finalObj),
  };
}
```

Replace the `makeCandidateChunkGenerator` helper with this, and update the tests:

**Test: "yields partial events from partialObjectStream"**

```typescript
it("yields partial and complete events from streamObject", async () => {
  const partials = [
    { candidates: [{ candidateIndex: 1, displayName: "Alice" }] },
    {
      candidates: [
        {
          candidateIndex: 1,
          displayName: "Alice",
          roleTitle: "Backend Engineer",
          persona: "Detail-oriented",
          summary: "Alice builds reliable systems.",
        },
        { candidateIndex: 2, displayName: "Bob" },
      ],
    },
  ];
  const final = {
    candidates: [
      {
        candidateIndex: 1,
        displayName: "Alice",
        roleTitle: "Backend Engineer",
        persona: "Detail-oriented",
        summary: "Alice builds reliable systems.",
      },
      {
        candidateIndex: 2,
        displayName: "Bob",
        roleTitle: "Frontend Engineer",
        persona: "Creative",
        summary: "Bob crafts UIs.",
      },
      {
        candidateIndex: 3,
        displayName: "Carol",
        roleTitle: "DevOps Engineer",
        persona: "Pragmatic",
        summary: "Carol keeps systems running.",
      },
    ],
  };

  (streamObject as jest.Mock).mockReturnValueOnce(
    mockStreamObjectReturn(partials, final),
  );

  const events: { type: string; data: unknown }[] = [];
  for await (const event of service.generateCandidates(
    INSTALLED_APP_ID,
    TENANT_ID,
    makeCandidatesDto(),
  )) {
    events.push(event);
  }

  const partialEvents = events.filter((e) => e.type === "partial");
  expect(partialEvents).toHaveLength(2);

  const completeEvents = events.filter((e) => e.type === "complete");
  expect(completeEvents).toHaveLength(1);
  expect((completeEvents[0].data as any).candidates).toHaveLength(3);
});
```

**Test: "throws BadRequestException for wrong app type"** — keep as-is (no mock changes needed).

**Test: "calls streamObject with correct params"**

```typescript
it("calls streamObject with temperature and schema", async () => {
  (streamObject as jest.Mock).mockReturnValueOnce(
    mockStreamObjectReturn([], { candidates: [] }),
  );

  for await (const _ of service.generateCandidates(
    INSTALLED_APP_ID,
    TENANT_ID,
    makeCandidatesDto(),
  )) {
    // consume
  }

  expect(streamObject).toHaveBeenCalledWith(
    expect.objectContaining({
      temperature: 0.95,
      schema: expect.any(Object),
    }),
  );
});
```

**Test: "includes jobTitle and jobDescription in prompt"**

```typescript
it("includes jobTitle and jobDescription in the prompt", async () => {
  (streamObject as jest.Mock).mockReturnValueOnce(
    mockStreamObjectReturn([], { candidates: [] }),
  );

  for await (const _ of service.generateCandidates(
    INSTALLED_APP_ID,
    TENANT_ID,
    makeCandidatesDto({
      jobTitle: "Data Scientist",
      jobDescription: "Build ML models",
    }),
  )) {
    // consume
  }

  const callArg = (streamObject as jest.Mock).mock.calls[0][0] as {
    prompt: string;
  };
  expect(callArg.prompt).toContain("Data Scientist");
  expect(callArg.prompt).toContain("Build ML models");
});
```

**Test: "works with empty DTO"**

```typescript
it("uses default prompt when no job info provided", async () => {
  (streamObject as jest.Mock).mockReturnValueOnce(
    mockStreamObjectReturn([], { candidates: [] }),
  );

  for await (const _ of service.generateCandidates(
    INSTALLED_APP_ID,
    TENANT_ID,
    {},
  )) {
    // consume
  }

  const callArg = (streamObject as jest.Mock).mock.calls[0][0] as {
    prompt: string;
  };
  expect(callArg.prompt).toBeTruthy();
});
```

**Test: "yields empty when no partials"**

```typescript
it("yields only complete event when no partials emitted", async () => {
  (streamObject as jest.Mock).mockReturnValueOnce(
    mockStreamObjectReturn([], { candidates: [] }),
  );

  const events: { type: string; data: unknown }[] = [];
  for await (const event of service.generateCandidates(
    INSTALLED_APP_ID,
    TENANT_ID,
    makeCandidatesDto(),
  )) {
    events.push(event);
  }

  expect(events).toHaveLength(1);
  expect(events[0].type).toBe("complete");
});
```

Remove tests that no longer apply: "yields partial events for non-JSON text lines", "processes remaining buffer content", "skips JSON objects without candidateIndex" — these tested the manual JSON parsing which is now eliminated.

- [ ] **Step 4: Run all tests**

```bash
cd apps/server && npx jest --config apps/gateway/jest.config.cjs --testPathPattern common-staff.service.spec -- --verbose
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/applications/common-staff.service.ts \
       apps/server/apps/gateway/src/applications/common-staff.service.spec.ts
git commit -m "refactor: migrate generateCandidates to Vercel AI SDK streamObject + Zod schema"
```

---

### Task 3: Remove AiClientService from CommonStaffService

**Goal:** Clean up the now-unused `AiClientService` injection from `CommonStaffService` constructor and tests.

**Files:**

- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.ts:1-53`
- Modify: `apps/server/apps/gateway/src/applications/common-staff.service.spec.ts:5,193,225-229,242`

**Acceptance Criteria:**

- [ ] `AiClientService` and `AIProvider` imports removed from the service
- [ ] `AiClientService` removed from constructor injection
- [ ] `AiClientService` mock removed from test setup
- [ ] `AiClientModule` remains in `applications.module.ts` (other services may use it)
- [ ] All tests still pass

**Verify:** `cd apps/server && npx jest --config apps/gateway/jest.config.cjs --testPathPattern common-staff.service.spec -- --verbose 2>&1 | tail -5` → all tests PASS

**Steps:**

- [ ] **Step 1: Remove AiClientService from the service**

In `common-staff.service.ts`, remove the import line:

```typescript
import { AiClientService, AIProvider } from "@team9/ai-client";
```

Remove from the constructor:

```typescript
private readonly aiClientService: AiClientService,
```

- [ ] **Step 2: Remove AiClientService from the test**

In `common-staff.service.spec.ts`, remove:

```typescript
import { AiClientService } from "@team9/ai-client";
```

Remove the `aiClientService` variable declaration and its mock setup in `beforeEach`.

Remove from TestingModule providers:

```typescript
{ provide: AiClientService, useValue: aiClientService },
```

- [ ] **Step 3: Run tests**

```bash
cd apps/server && npx jest --config apps/gateway/jest.config.cjs --testPathPattern common-staff.service.spec -- --verbose
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/applications/common-staff.service.ts \
       apps/server/apps/gateway/src/applications/common-staff.service.spec.ts
git commit -m "refactor: remove unused AiClientService injection from CommonStaffService"
```

---

### Task 4: Update Frontend generateCandidates Consumer

**Goal:** Update the frontend SSE consumer and UI handler to consume progressive partial objects instead of `{ type: 'candidate', data }` events.

**Files:**

- Modify: `apps/client/src/services/api/applications.ts:686-751`
- Modify: `apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx:257-290`

**Acceptance Criteria:**

- [ ] `generateCandidates` in `applications.ts` returns `AsyncGenerator` with `partial` / `complete` event types
- [ ] Type reflects `data.candidates` as optional array of partial candidate objects
- [ ] `handleGenerateCandidates` in `CreateCommonStaffDialog.tsx` filters complete candidates from partial data
- [ ] UX unchanged: candidates appear one by one as they become fully populated

**Verify:** `cd apps/client && npx tsc --noEmit 2>&1 | tail -10` → no type errors

**Steps:**

- [ ] **Step 1: Update generateCandidates in applications.ts**

Replace the `generateCandidates` function (lines 686-751) with updated types. Change the return type and the inner type assertion:

```typescript
generateCandidates: async function* (
  appId: string,
  body: {
    jobTitle?: string;
    jobDescription?: string;
  },
): AsyncGenerator<{
  type: "partial" | "complete";
  data: {
    candidates?: Array<{
      candidateIndex?: number;
      displayName?: string;
      roleTitle?: string;
      persona?: string;
      summary?: string;
    }>;
  };
}> {
  const token = await getValidAccessToken();
  const url = `${API_BASE_URL}/v1/installed-applications/${appId}/common-staff/generate-candidates`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`generateCandidates failed: ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let sseBuffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return;
        try {
          const parsed = JSON.parse(payload) as {
            type: "partial" | "complete";
            data: {
              candidates?: Array<{
                candidateIndex?: number;
                displayName?: string;
                roleTitle?: string;
                persona?: string;
                summary?: string;
              }>;
            };
          };
          yield parsed;
        } catch {
          // ignore malformed lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
},
```

- [ ] **Step 2: Update handleGenerateCandidates in CreateCommonStaffDialog.tsx**

Replace the stream consumption loop (lines 268-279):

```typescript
for await (const event of stream) {
  if (event.type === "candidate" && event.data.candidateIndex != null) {
    const c = event.data as {
      candidateIndex: number;
      displayName: string;
      roleTitle: string;
      persona: string;
      summary: string;
    };
    setCandidates((prev) => [...prev, c]);
  }
}
```

With:

```typescript
for await (const event of stream) {
  if (event.type === "partial" || event.type === "complete") {
    const partialCandidates = event.data?.candidates ?? [];
    const complete = partialCandidates.filter(
      (
        c,
      ): c is {
        candidateIndex: number;
        displayName: string;
        roleTitle: string;
        persona: string;
        summary: string;
      } =>
        c.candidateIndex != null &&
        !!c.displayName &&
        !!c.roleTitle &&
        !!c.persona &&
        !!c.summary,
    );
    setCandidates(complete);
  }
}
```

- [ ] **Step 3: Type-check the client**

```bash
cd apps/client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/services/api/applications.ts \
       apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx
git commit -m "refactor: update frontend candidate consumer for streamObject partial events"
```

---

### Task 5: Final Verification and PR

**Goal:** Verify the full build, run all tests, and create PR to `dev`.

**Files:** None (verification only)

**Acceptance Criteria:**

- [ ] `pnpm build:server` succeeds
- [ ] All gateway tests pass
- [ ] Client type-check passes
- [ ] PR created targeting `dev` branch

**Verify:** `pnpm build:server` → success, `cd apps/server && npx jest --config apps/gateway/jest.config.cjs --verbose` → all pass

**Steps:**

- [ ] **Step 1: Build server**

```bash
pnpm build:server
```

Expected: clean build, no errors.

- [ ] **Step 2: Run all gateway tests**

```bash
cd apps/server && npx jest --config apps/gateway/jest.config.cjs --verbose
```

Expected: all tests pass.

- [ ] **Step 3: Type-check client**

```bash
cd apps/client && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Push and create PR**

```bash
git push -u origin feat/vercel-ai-openrouter-migration
```

Create PR:

```bash
gh pr create \
  --base dev \
  --title "refactor: migrate common-staff AI generation to Vercel AI SDK + OpenRouter" \
  --body "$(cat <<'EOF'
## Summary

- Replace `AiClientService.chat()` with Vercel AI SDK `streamText()` for persona generation
- Replace manual JSON-line parsing with `streamObject()` + Zod schema for candidate generation
- OpenRouter as model router (`anthropic/claude-sonnet-4-6`)
- Update frontend candidate consumer for progressive partial objects
- Remove `AiClientService` injection from `CommonStaffService`

## Test plan

- [ ] All `common-staff.service.spec.ts` tests pass
- [ ] `pnpm build:server` succeeds
- [ ] Client type-check passes
- [ ] Manual test: generate-persona SSE streams text chunks
- [ ] Manual test: generate-candidates SSE streams partial → complete events

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
