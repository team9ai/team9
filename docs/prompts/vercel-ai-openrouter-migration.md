# Task: Migrate Common Staff AI Generation to Vercel AI SDK + OpenRouter

## Background

The `common-staff` system (just merged to `dev`) has 3 AI generation endpoints:

- `POST .../generate-persona` — SSE streaming persona text
- `POST .../generate-candidates` — SSE streaming 3 candidate profiles
- `POST .../generate-avatar` — stub (returns DiceBear placeholder)

They currently use the internal `AiClientService` (from `@team9/ai-client`) which wraps Anthropic SDK directly. We want to replace this with **Vercel AI SDK** (`ai` package) + **OpenRouter** as the model router.

## What to Change

### Backend Only — 1 service file + deps

**File:** `apps/server/apps/gateway/src/applications/common-staff.service.ts`

Replace calls to `this.aiClientService.chat({ provider: AIProvider.CLAUDE, ... })` with Vercel AI SDK's `streamText()` from `ai` package + OpenRouter provider from `@ai-sdk/openai`.

**Current pattern (lines ~560-620):**

```typescript
import { AiClientService, AIProvider } from "@team9/ai-client";

// In generatePersona:
const stream = await this.aiClientService.chat({
  provider: AIProvider.CLAUDE,
  model: "claude-3-5-haiku-20241022",
  systemPrompt,
  messages: [{ role: "user", content: userMessage }],
  stream: true,
  temperature: 0.9,
  maxTokens: 1024,
});
for await (const chunk of stream) {
  yield chunk;
}
```

**Target pattern:**

```typescript
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// In generatePersona:
const result = streamText({
  model: openrouter("anthropic/claude-3.5-haiku"),
  system: systemPrompt,
  messages: [{ role: "user", content: userMessage }],
  temperature: 0.9,
  maxTokens: 1024,
});
for await (const chunk of result.textStream) {
  yield chunk;
}
```

### Methods to Migrate

1. **`generatePersona()`** (~line 540) — use **`streamText()`**, streams plain text chunks
2. **`generateCandidates()`** (~line 600) — use **`streamObject()`** with a Zod schema, streams structured candidate objects

`streamObject` is ideal for candidates because the current approach (stream raw text → try to parse JSON lines) is fragile. With `streamObject` + Zod, Vercel AI SDK handles the structured output natively:

```typescript
import { streamObject } from 'ai';
import { z } from 'zod';

const candidateSchema = z.object({
  candidates: z.array(z.object({
    candidateIndex: z.number(),
    displayName: z.string(),
    roleTitle: z.string(),
    persona: z.string(),
    summary: z.string(),
  })),
});

const result = streamObject({
  model: openrouter('anthropic/claude-3.5-haiku'),
  schema: candidateSchema,
  prompt: `Generate 3 diverse AI employee candidates...`,
  temperature: 0.95,
});

for await (const partial of result.partialObjectStream) {
  // partial.candidates is progressively populated
  yield { type: 'partial', data: partial };
}
```

This eliminates the manual JSON line parsing and buffer management in the current implementation. The frontend would receive progressively built candidate objects instead of raw text.

**Note:** Using `streamObject` changes the SSE event format. The frontend `generateCandidates` consumer in `applications.ts` will need a corresponding update to handle partial objects instead of `data: {"type":"candidate",...}` lines. Consider whether to update the frontend in this PR or keep the current SSE format and only change the server-side AI call.

### Dependencies

```bash
cd apps/server && pnpm add ai @ai-sdk/openai zod
```

(`zod` is needed for `streamObject` schema definition. Check if it's already installed — NestJS projects often have it.)

### Environment Variable

- **Name:** `OPENROUTER_API_KEY`
- **Where:** Railway dev + prod environments, `.env.example`
- **Used by:** Common staff persona/candidate generation only (for now)

### What NOT to Change

- **`AiClientService`** — keep it, other features use it (base-model-staff etc.)
- **Controller layer** — SSE streaming pattern stays the same
- **Frontend** — no changes needed, it consumes the same SSE format
- **`generateAvatar()`** — still a stub, not using AI yet

## OpenRouter Model IDs

Use OpenRouter model format (provider prefix):

- `anthropic/claude-3.5-haiku` (persona/candidates, cheap + fast)
- Or `anthropic/claude-sonnet-4` if better quality needed

Refer to https://openrouter.ai/models for the full list.

## Verification

1. `pnpm build:server` — compiles
2. Update tests in `common-staff.service.spec.ts` — mock `streamText` instead of `aiClientService.chat`
3. Manual test: `curl -N POST .../generate-persona` with valid auth → streams SSE text
4. CI lint + test pass

## PR Target

- Branch off `dev`
- PR into `dev`
- Title: `refactor: migrate common-staff AI generation to Vercel AI SDK + OpenRouter`
