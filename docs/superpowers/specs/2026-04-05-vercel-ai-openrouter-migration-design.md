# Migrate Common Staff AI Generation to Vercel AI SDK + OpenRouter

## Summary

Replace `AiClientService` calls in `CommonStaffService.generatePersona()` and
`CommonStaffService.generateCandidates()` with Vercel AI SDK (`ai` package) +
OpenRouter as the model router. This eliminates the fragile manual JSON-line
parsing in `generateCandidates` and decouples common-staff generation from the
internal `@team9/ai-client` wrapper.

## Motivation

- `generateCandidates` currently streams raw text and manually parses JSON
  lines with a buffer — fragile and error-prone.
- Vercel AI SDK's `streamText()` + `Output.object()` + Zod provides native structured output
  streaming, eliminating manual parsing entirely.
- OpenRouter as model router gives flexibility to switch models without code
  changes (just change the model ID string).
- `AiClientService` remains untouched — other features still use it.

## Scope

### In scope

| Area                                          | Change                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `common-staff.service.ts`                     | Replace `aiClientService.chat()` with `streamText()` / `streamText()` + `Output.object()` |
| `common-staff.service.spec.ts`                | Update mocks from `aiClientService.chat` to `streamText`                                  |
| `apps/client/.../applications.ts`             | Update `generateCandidates` consumer types for new event shape                            |
| `apps/client/.../CreateCommonStaffDialog.tsx` | Update `handleGenerateCandidates` to consume partial objects                              |
| `apps/server/package.json`                    | Add `ai`, `@ai-sdk/openai`, `zod`                                                         |
| `.env.example`                                | Add `OPENROUTER_API_KEY`                                                                  |

### Out of scope

- `AiClientService` itself (other features use it)
- Controller layer SSE pattern (unchanged)
- `generateAvatar()` stub
- `ApplicationsModule` DI wiring (keep `AiClientModule` import — other
  services may use it; remove `AiClientService` injection from
  `CommonStaffService` constructor only if no other methods reference it)

## Design

### OpenRouter Provider

Create the OpenRouter provider instance at module level in
`common-staff.service.ts`:

```typescript
import { createOpenAI } from "@ai-sdk/openai";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
```

Model ID: `anthropic/claude-sonnet-4-6`

### generatePersona() — streamText

Replace `aiClientService.chat()` with `streamText()`:

```typescript
import { streamText } from "ai";

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

- Return type unchanged: `AsyncGenerator<string>`
- Controller unchanged
- Frontend unchanged

### generateCandidates() — streamText + Output.object + Zod

> **Note:** `streamObject` was deprecated in `ai@6.x`. We use
> `streamText` with `Output.object({ schema })` instead, which provides
> identical structured-output streaming via the non-deprecated API.

Replace manual JSON-line parsing with `streamText()` + `Output.object()`:

```typescript
import { streamText, Output } from "ai";
import { z } from "zod";

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

Service yields progressive partial objects:

```typescript
const result = streamText({
  model: openrouter('anthropic/claude-sonnet-4-6'),
  output: Output.object({ schema: candidateSchema }),
  prompt: combinedPrompt,
  temperature: 0.95,
});

for await (const partial of result.partialOutputStream) {
  yield { type: 'partial', data: partial };
}
const final = await result.output;
yield { type: 'complete', data: final };
```

Return type changes to:
`AsyncGenerator<{ type: 'partial' | 'complete'; data: unknown }>`

The prompt for `streamText` with `Output.object` combines the current system
prompt context and user message parts into a single `prompt` string.

### Frontend: applications.ts generateCandidates

Update the return type to match the new event shape:

```typescript
AsyncGenerator<{
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
}>;
```

The SSE parsing logic itself is unchanged — still `data: <json>\n\n`.

### Frontend: CreateCommonStaffDialog.tsx handleGenerateCandidates

Replace the "push on candidate event" pattern with "replace state from
partial candidates":

```typescript
for await (const event of stream) {
  if (event.type === "partial" || event.type === "complete") {
    const partialCandidates = event.data?.candidates ?? [];
    const complete = partialCandidates.filter(
      (c) =>
        c.candidateIndex != null &&
        c.displayName &&
        c.roleTitle &&
        c.persona &&
        c.summary,
    );
    setCandidates(complete);
  }
}
```

Users see candidates appear one by one as each becomes fully populated in
the partial stream — same UX as before.

### Tests

- Jest-mock `streamText` and `Output` from the `'ai'` package at
  module level via `jest.unstable_mockModule`.
- `generatePersona` tests: mock `streamText` returning
  `{ textStream: asyncIterable }`. Verify prompt content, temperature,
  model, and chunk yielding.
- `generateCandidates` tests: mock `streamText` returning
  `{ partialOutputStream: asyncIterable, output: Promise }`. Verify schema
  usage, prompt content, and event yielding.
- Remove all `aiClientService.chat` mocks/assertions from persona and
  candidate tests.
- Keep business-logic tests (app verification, DTO field inclusion, error
  propagation).

### Dependencies

```bash
cd apps/server && pnpm add ai @ai-sdk/openai zod
```

### Environment Variable

- Name: `OPENROUTER_API_KEY`
- Add to `.env.example` with empty placeholder
- Required at runtime for persona/candidate generation only

### Branch & PR

- Branch off `dev`
- PR into `dev`
- Title: `refactor: migrate common-staff AI generation to Vercel AI SDK + OpenRouter`
