# Long Text Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `long_text` message type with automatic detection, truncated broadcast, on-demand full content retrieval, and collapsible UI.

**Architecture:** Server auto-detects long text (>=20 lines OR >=2000 chars), stores full content in DB, broadcasts truncated preview (20 lines / 3000 chars). Client renders collapsed view (~10 lines with gradient fade-out), fetches full content on demand via new `GET /messages/:id/full-content` endpoint.

**Tech Stack:** NestJS, Drizzle ORM, PostgreSQL, React, TanStack React Query, Tailwind CSS, Framer Motion

**Spec:** `docs/superpowers/specs/2026-04-11-long-text-message-design.md`

---

## File Structure

| Action | Path                                                                        | Responsibility                                                          |
| ------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Modify | `apps/server/libs/database/src/schemas/im/messages.ts`                      | Add `long_text` to enum                                                 |
| Create | `apps/server/libs/database/migrations/0033_long_text_message_type.sql`      | DB migration                                                            |
| Modify | `apps/server/libs/shared/src/types/message.types.ts`                        | Update type unions                                                      |
| Modify | `apps/server/libs/shared/src/events/domains/message.events.ts`              | Update WSMessageType                                                    |
| Modify | `apps/server/apps/gateway/src/im/messages/dto/create-message.dto.ts`        | MaxLength 100000                                                        |
| Modify | `apps/server/apps/gateway/src/im/messages/dto/update-message.dto.ts`        | MaxLength 100000                                                        |
| Modify | `apps/server/apps/gateway/src/im/messages/messages.controller.ts`           | Type detection + truncation + new endpoint                              |
| Modify | `apps/server/apps/gateway/src/im/messages/messages.service.ts`              | `truncateForPreview()` + `getFullContent()` + update type on edit       |
| Create | `apps/server/apps/gateway/src/im/messages/messages.service.spec.ts`         | Tests for new service methods                                           |
| Modify | `apps/server/apps/gateway/src/im/services/im-worker-grpc-client.service.ts` | gRPC channel options                                                    |
| Modify | `apps/server/apps/im-worker/src/message/message.grpc-controller.ts`         | Accept `long_text` type                                                 |
| Modify | `apps/server/apps/im-worker/src/main.ts`                                    | gRPC channel options                                                    |
| Modify | `apps/server/apps/gateway/src/main.ts`                                      | Body parser limit                                                       |
| Modify | `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`            | maxHttpBufferSize                                                       |
| Modify | `apps/client/src/types/im.ts`                                               | Update MessageType + Message interface                                  |
| Modify | `apps/client/src/services/api/im.ts`                                        | Add `getFullContent()` API call                                         |
| Create | `apps/client/src/components/channel/LongTextCollapse.tsx`                   | Collapse/expand UI component                                            |
| Create | `apps/client/src/components/channel/__tests__/LongTextCollapse.test.tsx`    | Component tests                                                         |
| Modify | `apps/client/src/components/channel/MessageContent.tsx`                     | Wrap long_text in LongTextCollapse                                      |
| Modify | `apps/client/src/hooks/useMessages.ts`                                      | Invalidate full-content cache on message_updated; pre-send length check |

---

### Task 0: Database Schema & Shared Types

**Goal:** Add `long_text` to the message type enum at DB and TypeScript levels.

**Files:**

- Modify: `apps/server/libs/database/src/schemas/im/messages.ts:16-22`
- Create: `apps/server/libs/database/migrations/0033_long_text_message_type.sql`
- Modify: `apps/server/libs/shared/src/types/message.types.ts:46-55,235-265`
- Modify: `apps/server/libs/shared/src/events/domains/message.events.ts:12`
- Modify: `apps/client/src/types/im.ts:4,152-184`

**Acceptance Criteria:**

- [ ] `messageTypeEnum` includes `'long_text'`
- [ ] Migration SQL adds the enum value
- [ ] All TypeScript type unions include `'long_text'`
- [ ] `pnpm db:migrate` runs cleanly
- [ ] Existing message queries still work (no regression)

**Verify:** `pnpm db:migrate && pnpm build:server` → builds with no errors

**Steps:**

- [ ] **Step 1: Update the Drizzle schema enum**

In `apps/server/libs/database/src/schemas/im/messages.ts`, add `'long_text'` to the enum:

```typescript
export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "file",
  "image",
  "system",
  "tracking",
  "long_text",
]);
```

- [ ] **Step 2: Generate and verify migration**

Run: `pnpm db:generate`

This creates a migration file. If the auto-generated name differs from `0033_long_text_message_type.sql`, that's fine — Drizzle names migrations automatically. The SQL should contain:

```sql
ALTER TYPE "message_type" ADD VALUE 'long_text';
```

- [ ] **Step 3: Run the migration**

Run: `pnpm db:migrate`
Expected: Migration applied successfully, no errors.

- [ ] **Step 4: Update server shared types**

In `apps/server/libs/shared/src/types/message.types.ts`, update `MessageType` (line 46-55):

```typescript
export type MessageType =
  | "text"
  | "file"
  | "image"
  | "system"
  | "tracking"
  | "long_text"
  | "ack"
  | "typing"
  | "read"
  | "presence";
```

Update `CreateMessageDto.type` (line 255):

```typescript
type: "text" | "file" | "image" | "long_text";
```

- [ ] **Step 5: Update WSMessageType**

In `apps/server/libs/shared/src/events/domains/message.events.ts` (line 12):

```typescript
export type WSMessageType =
  | "text"
  | "file"
  | "image"
  | "system"
  | "tracking"
  | "long_text";
```

- [ ] **Step 6: Update client types**

In `apps/client/src/types/im.ts`, update `MessageType` (line 4):

```typescript
export type MessageType =
  | "text"
  | "file"
  | "image"
  | "system"
  | "tracking"
  | "long_text";
```

Add new fields to the `Message` interface (after line 165 `type: MessageType;`):

```typescript
  isTruncated?: boolean;
  fullContentLength?: number;
```

- [ ] **Step 7: Update MessageResponse on server**

In `apps/server/apps/gateway/src/im/messages/messages.service.ts`, update the `MessageResponse` interface (line 66):

```typescript
type: "text" | "file" | "image" | "system" | "tracking" | "long_text";
```

Add after `metadata` (line 78):

```typescript
  isTruncated?: boolean;
  fullContentLength?: number;
```

- [ ] **Step 8: Verify build**

Run: `pnpm build:server`
Expected: No TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add apps/server/libs/database/src/schemas/im/messages.ts \
  apps/server/libs/database/migrations/ \
  apps/server/libs/shared/src/types/message.types.ts \
  apps/server/libs/shared/src/events/domains/message.events.ts \
  apps/server/apps/gateway/src/im/messages/messages.service.ts \
  apps/client/src/types/im.ts
git commit -m "feat(db): add long_text message type enum and update type definitions"
```

---

### Task 1: Server Configuration & Limits

**Goal:** Raise payload size limits for Express body parser, Socket.io, and gRPC to support 100K char messages.

**Files:**

- Modify: `apps/server/apps/gateway/src/main.ts:36`
- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts:66-75`
- Modify: `apps/server/apps/gateway/src/im/services/im-worker-grpc-client.service.ts:99-110`
- Modify: `apps/server/apps/im-worker/src/main.ts:24-39`

**Acceptance Criteria:**

- [ ] Express JSON body parser limit set to 1MB
- [ ] Socket.io `maxHttpBufferSize` set to 1MB
- [ ] gRPC client `channelOptions` set max message sizes to 4MB
- [ ] gRPC server `channelOptions` set max message sizes to 4MB

**Verify:** `pnpm build:server` → no errors

**Steps:**

- [ ] **Step 1: Configure Express body parser**

In `apps/server/apps/gateway/src/main.ts`, add `rawBody: true` option and body parser config. After `const app = await NestFactory.create(AppModule);` (line 36), add:

```typescript
const app = await NestFactory.create(AppModule, {
  rawBody: true,
  bodyParser: true,
});

// Raise JSON body limit to 1MB for long_text messages (default 100KB)
const expressApp = app.getHttpAdapter().getInstance();
const bodyParser = await import("body-parser");
expressApp.use(bodyParser.json({ limit: "1mb" }));
```

Note: Check if NestJS already has a built-in way to set this. If `NestFactory.create` supports a `bodyParser` option with limit, prefer that. Otherwise use the explicit middleware approach above.

- [ ] **Step 2: Configure Socket.io maxHttpBufferSize**

In `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`, update the `@WebSocketGateway` decorator (line 66-75):

```typescript
@WebSocketGateway({
  cors: {
    origin:
      env.CORS_ORIGIN === '*'
        ? true
        : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  },
  namespace: '/im',
  maxHttpBufferSize: 1_000_000, // 1MB for long_text messages
})
```

- [ ] **Step 3: Configure gRPC client channel options**

In `apps/server/apps/gateway/src/im/services/im-worker-grpc-client.service.ts`, add `channelOptions` to the gRPC client config (inside the `ClientProxyFactory.create` options):

```typescript
options: {
  package: 'message',
  protoPath: MESSAGE_SERVICE_PROTO_PATH,
  url: this.grpcUrl,
  channelOptions: {
    'grpc.max_receive_message_length': 4 * 1024 * 1024, // 4MB
    'grpc.max_send_message_length': 4 * 1024 * 1024,    // 4MB
  },
  loader: {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  },
},
```

- [ ] **Step 4: Configure gRPC server channel options**

In `apps/server/apps/im-worker/src/main.ts`, add `channelOptions` (inside `connectMicroservice` options):

```typescript
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.GRPC,
  options: {
    package: "message",
    protoPath: MESSAGE_SERVICE_PROTO_PATH,
    url: `[::]:${grpcPort}`,
    channelOptions: {
      "grpc.max_receive_message_length": 4 * 1024 * 1024, // 4MB
      "grpc.max_send_message_length": 4 * 1024 * 1024, // 4MB
    },
    loader: {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    },
  },
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/main.ts \
  apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts \
  apps/server/apps/gateway/src/im/services/im-worker-grpc-client.service.ts \
  apps/server/apps/im-worker/src/main.ts
git commit -m "feat(server): raise payload limits for long_text message support"
```

---

### Task 2: DTO Validation & Type Detection Logic

**Goal:** Raise MaxLength to 100000 on DTOs, implement `determineMessageType()` and `countLogicalLines()` helper functions, and wire into message creation and edit flows.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/dto/create-message.dto.ts:36`
- Modify: `apps/server/apps/gateway/src/im/messages/dto/update-message.dto.ts:5`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts:147`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.ts`
- Modify: `apps/server/apps/im-worker/src/message/message.grpc-controller.ts:88,103`
- Test: `apps/server/apps/gateway/src/im/messages/messages.service.spec.ts`

**Acceptance Criteria:**

- [ ] `CreateMessageDto.content` allows up to 100,000 chars
- [ ] `UpdateMessageDto.content` allows up to 100,000 chars
- [ ] Messages with >=20 logical lines OR >=2000 chars get type `long_text`
- [ ] Line counting handles HTML (`<p>`, `<br>`, `\n` in `<pre>`) and Markdown (`\n`)
- [ ] Message edit re-determines type (can upgrade/downgrade)
- [ ] IM Worker gRPC controller accepts `long_text` type
- [ ] Unit tests cover line counting and type detection

**Verify:** `cd apps/server && pnpm jest --testPathPattern=messages.service.spec` → all pass

**Steps:**

- [ ] **Step 1: Write tests for `countLogicalLines()` and `determineMessageType()`**

Add to `apps/server/apps/gateway/src/im/messages/messages.service.spec.ts`:

```typescript
import { countLogicalLines, determineMessageType } from "./message-utils.js";

describe("countLogicalLines", () => {
  it("counts <p> tags as lines", () => {
    expect(countLogicalLines("<p>line 1</p><p>line 2</p><p>line 3</p>")).toBe(
      3,
    );
  });

  it("counts <br> as line breaks", () => {
    // 2 <br> tags = 2 line breaks, but there's content around them implying 3 visual lines.
    // However, our HTML counter counts block elements, not text spans between them.
    // <br> within non-block context: count <br> tags as separators.
    // Adjust: wrap in <p> for realistic Lexical output
    expect(countLogicalLines("<p>line 1<br>line 2<br>line 3</p>")).toBe(3);
  });

  it("counts newlines inside <pre> blocks", () => {
    const code = "<pre><code>line1\nline2\nline3\nline4</code></pre>";
    expect(countLogicalLines(code)).toBe(4);
  });

  it("counts mixed HTML elements", () => {
    const html = "<p>intro</p><pre><code>a\nb\nc</code></pre><p>outro</p>";
    // 2 <p> tags + 3 lines in <pre> = 5
    expect(countLogicalLines(html)).toBe(5);
  });

  it("counts plain text newlines (Markdown/bot messages)", () => {
    expect(countLogicalLines("line1\nline2\nline3")).toBe(3);
  });

  it("returns 1 for single line content", () => {
    expect(countLogicalLines("hello world")).toBe(1);
  });

  it("returns 0 for empty string", () => {
    expect(countLogicalLines("")).toBe(0);
  });
});

describe("determineMessageType", () => {
  it("returns file when hasAttachments is true", () => {
    expect(determineMessageType("short text", true)).toBe("file");
  });

  it("returns text for short content", () => {
    expect(determineMessageType("hello", false)).toBe("text");
  });

  it("returns long_text when chars >= 2000", () => {
    const longContent = "a".repeat(2000);
    expect(determineMessageType(longContent, false)).toBe("long_text");
  });

  it("returns long_text when lines >= 20", () => {
    const manyLines = Array.from(
      { length: 20 },
      (_, i) => `<p>line ${i}</p>`,
    ).join("");
    expect(determineMessageType(manyLines, false)).toBe("long_text");
  });

  it("returns text when just below thresholds", () => {
    const content = Array.from(
      { length: 19 },
      (_, i) => `<p>line ${i}</p>`,
    ).join("");
    // 19 lines and under 2000 chars
    expect(determineMessageType(content, false)).toBe("text");
  });

  it("returns long_text for 20 newlines in Markdown", () => {
    const md = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    expect(determineMessageType(md, false)).toBe("long_text");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && pnpm jest --testPathPattern=messages.service.spec`
Expected: FAIL — `message-utils` module not found.

- [ ] **Step 3: Create `message-utils.ts` with implementation**

Create `apps/server/apps/gateway/src/im/messages/message-utils.ts`:

```typescript
/**
 * Count logical lines in message content.
 *
 * For HTML content (from Lexical editor):
 *   - Each <p> tag counts as one line
 *   - Each <br> counts as one line break
 *   - Newlines inside <pre> blocks count as lines
 *
 * For plain text / Markdown (bot messages):
 *   - Split by \n
 *
 * @returns number of logical lines
 */
export function countLogicalLines(content: string): number {
  if (!content) return 0;

  const isHtml = /<(?:p|pre|br)\b/i.test(content);

  if (!isHtml) {
    // Plain text / Markdown: count by newlines
    return content.split("\n").length;
  }

  let lineCount = 0;

  // Count <p> tags (each is a logical line)
  const pMatches = content.match(/<p[\s>]/gi);
  if (pMatches) lineCount += pMatches.length;

  // Count <br> tags (each is a line break, adding a line)
  const brMatches = content.match(/<br\s*\/?>/gi);
  if (brMatches) lineCount += brMatches.length;

  // Count newlines inside <pre> blocks
  const preRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let match: RegExpExecArray | null;
  while ((match = preRegex.exec(content)) !== null) {
    const preContent = match[1];
    const newlineCount = (preContent.match(/\n/g) || []).length;
    lineCount += newlineCount + 1; // +1 for the first line in <pre>
  }

  // If we found <pre> blocks, subtract the <p> or <br> that might wrap them
  // (Lexical doesn't wrap <pre> in <p>, so this is usually not needed)

  return Math.max(lineCount, 1); // At least 1 line if content exists
}

/** Long text detection thresholds */
const LONG_TEXT_LINE_THRESHOLD = 20;
const LONG_TEXT_CHAR_THRESHOLD = 2000;

/**
 * Determine message type based on content length and attachments.
 */
export function determineMessageType(
  content: string,
  hasAttachments: boolean,
): "text" | "file" | "long_text" {
  if (hasAttachments) return "file";

  const lineCount = countLogicalLines(content);
  if (
    lineCount >= LONG_TEXT_LINE_THRESHOLD ||
    content.length >= LONG_TEXT_CHAR_THRESHOLD
  ) {
    return "long_text";
  }

  return "text";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && pnpm jest --testPathPattern=messages.service.spec`
Expected: All `countLogicalLines` and `determineMessageType` tests PASS.

- [ ] **Step 5: Update DTOs**

In `apps/server/apps/gateway/src/im/messages/dto/create-message.dto.ts` (line 36):

```typescript
  @IsString()
  @MaxLength(100000)
  content: string;
```

In `apps/server/apps/gateway/src/im/messages/dto/update-message.dto.ts` (line 5):

```typescript
  @IsString()
  @MaxLength(100000)
  content: string;
```

- [ ] **Step 6: Wire type detection into message creation**

In `apps/server/apps/gateway/src/im/messages/messages.controller.ts`, replace line 147:

```typescript
// Old: const messageType = dto.attachments?.length ? 'file' : 'text';
const messageType = determineMessageType(
  dto.content,
  !!dto.attachments?.length,
);
```

Add import at top:

```typescript
import { determineMessageType } from "./message-utils.js";
```

- [ ] **Step 7: Wire type re-detection into message edit**

In `apps/server/apps/gateway/src/im/messages/messages.service.ts`, update the `update()` method (line 877-884). Add type re-determination:

```typescript
const newType = determineMessageType(dto.content, false);

await this.db
  .update(schema.messages)
  .set({
    content: dto.content,
    type: newType,
    isEdited: true,
    seqId: newSeqId,
    updatedAt: new Date(),
  })
  .where(eq(schema.messages.id, messageId));
```

Add import at top:

```typescript
import { determineMessageType } from "./message-utils.js";
```

- [ ] **Step 8: Update IM Worker to accept `long_text` type**

In `apps/server/apps/im-worker/src/message/message.grpc-controller.ts`:

Update content validation (line 88) to also check `long_text`:

```typescript
if (
  !request.content &&
  (request.type === "text" || request.type === "long_text")
) {
  throw new RpcException({
    code: status.INVALID_ARGUMENT,
    message: "content is required for text messages",
  });
}
```

Update the type cast (line 103):

```typescript
        type: request.type as 'text' | 'file' | 'image' | 'long_text',
```

- [ ] **Step 9: Verify build and tests**

Run: `pnpm build:server`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/message-utils.ts \
  apps/server/apps/gateway/src/im/messages/messages.service.spec.ts \
  apps/server/apps/gateway/src/im/messages/dto/ \
  apps/server/apps/gateway/src/im/messages/messages.controller.ts \
  apps/server/apps/gateway/src/im/messages/messages.service.ts \
  apps/server/apps/im-worker/src/message/message.grpc-controller.ts
git commit -m "feat(messages): add long_text type detection and raise MaxLength to 100000"
```

---

### Task 3: Truncation & Full Content API

**Goal:** Implement `truncateForPreview()` in MessagesService, apply truncation to broadcast and list endpoints, add `GET /messages/:id/full-content` endpoint.

**Files:**

- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.ts`
- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts`
- Test: `apps/server/apps/gateway/src/im/messages/messages.service.spec.ts`

**Acceptance Criteria:**

- [ ] `truncateForPreview()` truncates to 20 lines OR 3000 chars (whichever first)
- [ ] Sets `isTruncated: true` and `fullContentLength` on truncated messages
- [ ] Non-long_text messages pass through unchanged
- [ ] `GET /messages/:id/full-content` returns full content with auth + membership check
- [ ] Truncation applied to WebSocket broadcast in controller
- [ ] Truncation applied to message list responses
- [ ] Unit tests for truncation logic

**Verify:** `cd apps/server && pnpm jest --testPathPattern=messages.service.spec` → all pass

**Steps:**

- [ ] **Step 1: Write tests for `truncateContent()`**

Add to `apps/server/apps/gateway/src/im/messages/messages.service.spec.ts`:

```typescript
import { truncateContent } from "./message-utils.js";

describe("truncateContent", () => {
  it("does not truncate content under limits", () => {
    const result = truncateContent("<p>short</p>");
    expect(result).toEqual({
      content: "<p>short</p>",
      isTruncated: false,
      fullContentLength: "<p>short</p>".length,
    });
  });

  it("truncates by line count at 20 lines", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `<p>line ${i}</p>`);
    const content = lines.join("");
    const result = truncateContent(content);
    expect(result.isTruncated).toBe(true);
    expect(result.fullContentLength).toBe(content.length);
    // Should contain first 20 <p> tags
    const pCount = (result.content.match(/<p[\s>]/gi) || []).length;
    expect(pCount).toBe(20);
  });

  it("truncates by char count at 3000 chars", () => {
    // 10 lines of 400 chars each = 4000 chars, under 20 lines
    const lines = Array.from(
      { length: 10 },
      (_, i) => `<p>${"x".repeat(395)}${i}</p>`,
    );
    const content = lines.join("");
    const result = truncateContent(content);
    expect(result.isTruncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(3000 + 50); // Allow tag closure overhead
  });

  it("truncates Markdown by newlines", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const content = lines.join("\n");
    const result = truncateContent(content);
    expect(result.isTruncated).toBe(true);
    const resultLines = result.content.split("\n");
    expect(resultLines.length).toBe(20);
  });
});
```

- [ ] **Step 2: Implement `truncateContent()` in message-utils.ts**

Add to `apps/server/apps/gateway/src/im/messages/message-utils.ts`:

```typescript
const PREVIEW_LINE_LIMIT = 20;
const PREVIEW_CHAR_LIMIT = 3000;

export interface TruncateResult {
  content: string;
  isTruncated: boolean;
  fullContentLength: number;
}

/**
 * Truncate message content for preview.
 * Truncates at 20 logical lines OR 3000 characters, whichever comes first.
 */
export function truncateContent(content: string): TruncateResult {
  const fullContentLength = content.length;
  const isHtml = /<(?:p|pre|br)\b/i.test(content);

  if (!isHtml) {
    return truncateMarkdown(content, fullContentLength);
  }
  return truncateHtml(content, fullContentLength);
}

function truncateMarkdown(
  content: string,
  fullContentLength: number,
): TruncateResult {
  const lines = content.split("\n");
  if (
    lines.length <= PREVIEW_LINE_LIMIT &&
    content.length <= PREVIEW_CHAR_LIMIT
  ) {
    return { content, isTruncated: false, fullContentLength };
  }

  // Truncate by lines first
  let truncated = lines.slice(0, PREVIEW_LINE_LIMIT).join("\n");

  // Then check char limit
  if (truncated.length > PREVIEW_CHAR_LIMIT) {
    truncated = truncated.slice(0, PREVIEW_CHAR_LIMIT);
    // Try to break at last newline to avoid mid-line cut
    const lastNewline = truncated.lastIndexOf("\n");
    if (lastNewline > PREVIEW_CHAR_LIMIT * 0.5) {
      truncated = truncated.slice(0, lastNewline);
    }
  }

  return { content: truncated, isTruncated: true, fullContentLength };
}

function truncateHtml(
  content: string,
  fullContentLength: number,
): TruncateResult {
  if (content.length <= PREVIEW_CHAR_LIMIT) {
    // Under char limit — check line count
    const lineCount = countLogicalLines(content);
    if (lineCount <= PREVIEW_LINE_LIMIT) {
      return { content, isTruncated: false, fullContentLength };
    }
  }

  // Walk through the HTML and collect block elements up to the line limit
  let lineCount = 0;
  let charCount = 0;
  let cutIndex = content.length;
  let isTruncated = false;

  // Strategy: find boundaries of block elements (<p>...</p>, <pre>...</pre>, <br>)
  // and count lines, stopping when we hit the limit
  const blockRegex = /<(p|pre|br)[\s>]/gi;
  const positions: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(content)) !== null) {
    positions.push(match.index);
  }

  // Count lines at each block boundary
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    // Check char count up to this position
    if (pos > PREVIEW_CHAR_LIMIT) {
      cutIndex = positions[Math.max(0, i - 1)] || 0;
      // Find the closing tag
      const closingIdx = findClosingTag(content, cutIndex);
      cutIndex = closingIdx;
      isTruncated = true;
      break;
    }

    lineCount++;

    // Check if content at this position is <pre> — count internal newlines
    if (
      content
        .slice(pos, pos + 4)
        .toLowerCase()
        .startsWith("<pre")
    ) {
      const preEnd = content.indexOf("</pre>", pos);
      if (preEnd !== -1) {
        const preContent = content.slice(pos, preEnd);
        const newlines = (preContent.match(/\n/g) || []).length;
        lineCount += newlines; // Additional lines within <pre>
      }
    }

    if (lineCount >= PREVIEW_LINE_LIMIT) {
      // Include this element, cut after its closing tag
      const closingIdx = findClosingTag(content, pos);
      cutIndex = closingIdx;
      isTruncated = true;
      break;
    }
  }

  if (!isTruncated && content.length > PREVIEW_CHAR_LIMIT) {
    // Over char limit but under line limit — cut at char limit
    cutIndex = PREVIEW_CHAR_LIMIT;
    // Try to cut at a tag boundary
    const lastClose = content.lastIndexOf(">", cutIndex);
    if (lastClose > PREVIEW_CHAR_LIMIT * 0.5) {
      cutIndex = lastClose + 1;
    }
    isTruncated = true;
  }

  if (!isTruncated) {
    return { content, isTruncated: false, fullContentLength };
  }

  return {
    content: content.slice(0, cutIndex),
    isTruncated: true,
    fullContentLength,
  };
}

function findClosingTag(html: string, startPos: number): number {
  // Find the tag name at startPos
  const tagMatch = html.slice(startPos).match(/^<(\w+)/);
  if (!tagMatch) return startPos;

  const tagName = tagMatch[1].toLowerCase();

  // Self-closing tags
  if (tagName === "br") {
    const brEnd = html.indexOf(">", startPos);
    return brEnd !== -1 ? brEnd + 1 : startPos;
  }

  // Find matching closing tag
  const closingTag = `</${tagName}>`;
  const closingIdx = html.indexOf(closingTag, startPos);
  return closingIdx !== -1 ? closingIdx + closingTag.length : html.length;
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd apps/server && pnpm jest --testPathPattern=messages.service.spec`
Expected: All truncation tests PASS.

- [ ] **Step 4: Add `truncateForPreview()` to MessagesService**

In `apps/server/apps/gateway/src/im/messages/messages.service.ts`, add a method:

```typescript
  /**
   * Apply truncation to long_text messages for preview.
   * Non-long_text messages pass through unchanged.
   */
  truncateForPreview(message: MessageResponse): MessageResponse {
    if (message.type !== 'long_text' || !message.content) {
      return message;
    }

    const { content, isTruncated, fullContentLength } = truncateContent(message.content);
    return {
      ...message,
      content,
      isTruncated,
      fullContentLength,
    };
  }
```

Add import:

```typescript
import { truncateContent } from "./message-utils.js";
```

- [ ] **Step 5: Add `getFullContent()` to MessagesService**

```typescript
  /**
   * Get the full (untruncated) content of a message.
   */
  async getFullContent(messageId: string): Promise<{ content: string }> {
    const [message] = await this.db
      .select({ content: schema.messages.content })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return { content: message.content ?? '' };
  }
```

- [ ] **Step 6: Apply truncation in controller — message creation broadcast**

In `apps/server/apps/gateway/src/im/messages/messages.controller.ts`, update the broadcast section (around line 172-178):

```typescript
if (!dto.skipBroadcast) {
  const previewMessage = this.messagesService.truncateForPreview(message);
  await this.websocketGateway.sendToChannelMembers(
    channelId,
    WS_EVENTS.MESSAGE.NEW,
    previewMessage,
  );
}
```

Also apply truncation to the HTTP response (before `return message` at the end of `createMessage`):

```typescript
return this.messagesService.truncateForPreview(message);
```

- [ ] **Step 7: Apply truncation in controller — message update broadcast**

In the `updateMessage` method (around line 308), apply truncation:

```typescript
const previewMessage = this.messagesService.truncateForPreview(message);
await this.websocketGateway.sendToChannelMembers(
  message.channelId,
  WS_EVENTS.MESSAGE.UPDATED,
  previewMessage,
);
// ...
return previewMessage;
```

- [ ] **Step 8: Apply truncation in service — message list queries**

In `getMessagesWithDetailsBatch()` (around line 460), before returning the array, map through truncation:

```typescript
return messages.map((msg) => this.truncateForPreview(msg));
```

Note: `truncateForPreview` is a method on the service, so this works directly.

Similarly for `getChannelMessages()`, `getThread()`, and `getSubReplies()`.

- [ ] **Step 9: Add full-content endpoint to controller**

In `apps/server/apps/gateway/src/im/messages/messages.controller.ts`, add a new endpoint:

```typescript
  @Get('messages/:id/full-content')
  async getFullContent(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
  ): Promise<{ content: string }> {
    // Verify the user is a member of the message's channel
    const channelId = await this.messagesService.getMessageChannelId(messageId);
    const isMember = await this.channelsService.isMember(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('Access denied');
    }

    return this.messagesService.getFullContent(messageId);
  }
```

- [ ] **Step 10: Verify build and run tests**

Run: `pnpm build:server && cd apps/server && pnpm jest --testPathPattern=messages.service.spec`
Expected: Build passes, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add apps/server/apps/gateway/src/im/messages/message-utils.ts \
  apps/server/apps/gateway/src/im/messages/messages.service.ts \
  apps/server/apps/gateway/src/im/messages/messages.service.spec.ts \
  apps/server/apps/gateway/src/im/messages/messages.controller.ts
git commit -m "feat(messages): add truncation for long_text preview and full-content endpoint"
```

---

### Task 4: Client API & Cache Integration

**Goal:** Add `getFullContent()` API call, update message_updated handler to invalidate full-content cache, add pre-send length validation.

**Files:**

- Modify: `apps/client/src/services/api/im.ts`
- Modify: `apps/client/src/hooks/useMessages.ts`

**Acceptance Criteria:**

- [ ] `imApi.messages.getFullContent(messageId)` calls `GET /messages/:id/full-content`
- [ ] `message_updated` WebSocket handler invalidates `['message-full-content', messageId]`
- [ ] `useSendMessage` blocks sends over 100,000 chars with error toast
- [ ] React Query `useFullContent` hook with `staleTime: Infinity`

**Verify:** `pnpm build:client` → no TypeScript errors

**Steps:**

- [ ] **Step 1: Add getFullContent API method**

In `apps/client/src/services/api/im.ts`, add after `getMessage`:

```typescript
  // Get full content of a long_text message
  getFullContent: async (messageId: string): Promise<{ content: string }> => {
    const response = await http.get<{ content: string }>(
      `/v1/im/messages/${messageId}/full-content`,
    );
    return response.data;
  },
```

- [ ] **Step 2: Add useFullContent hook**

In `apps/client/src/hooks/useMessages.ts`, add a new hook:

```typescript
/**
 * Hook to fetch the full content of a long_text message.
 * Only fetches when enabled (user clicks "expand").
 */
export function useFullContent(messageId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["message-full-content", messageId],
    queryFn: () => imApi.messages.getFullContent(messageId),
    enabled,
    staleTime: Infinity,
  });
}
```

- [ ] **Step 3: Invalidate full-content cache on message_updated**

In `apps/client/src/hooks/useMessages.ts`, inside the `handleMessageUpdated` callback (around line 350), add:

```typescript
const handleMessageUpdated = (message: Message) => {
  if (message.channelId !== channelId) return;

  // Invalidate full-content cache for edited long_text messages
  queryClient.invalidateQueries({
    queryKey: ["message-full-content", message.id],
  });

  queryClient.setQueryData<MessagesQueryData>();
  // ... existing logic
};
```

- [ ] **Step 4: Add pre-send length validation**

In `apps/client/src/hooks/useMessages.ts`, in the `useSendMessage` hook's `mutationFn` (around line 1469), add validation before the API call:

```typescript
    mutationFn: (data: CreateMessageDto) => {
      if (data.content && data.content.length > 100000) {
        throw new Error('消息内容过长，请缩减后重试');
      }
      return imApi.messages.sendMessage(channelId!, data);
    },
```

- [ ] **Step 5: Verify build**

Run: `pnpm build:client`
Expected: No TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/services/api/im.ts \
  apps/client/src/hooks/useMessages.ts
git commit -m "feat(client): add full-content API, cache invalidation, and length validation"
```

---

### Task 5: LongTextCollapse Component & MessageContent Integration

**Goal:** Create the LongTextCollapse component with gradient fade-out, expand button, and full-content fetching. Integrate into MessageContent.

**Files:**

- Create: `apps/client/src/components/channel/LongTextCollapse.tsx`
- Create: `apps/client/src/components/channel/__tests__/LongTextCollapse.test.tsx`
- Modify: `apps/client/src/components/channel/MessageContent.tsx`
- Modify: `apps/client/src/components/channel/MessageItem.tsx`

**Acceptance Criteria:**

- [ ] Long_text messages show ~10 lines with gradient fade-out
- [ ] "展开全文（还有约 X 字）↓" button shows remaining character count
- [ ] Click expand: if `!isTruncated`, expand in-place with animation (no network)
- [ ] Click expand: if `isTruncated`, fetch full-content, show loading, then expand
- [ ] Expanded state: gradient and button disappear, full content shown
- [ ] State resets on unmount (channel switch / refresh)
- [ ] Error state: "加载失败，点击重试" on fetch failure
- [ ] Non-long_text messages render unchanged
- [ ] Tests cover collapsed, expanded, loading, error states

**Verify:** `cd apps/client && pnpm vitest run --testPathPattern=LongTextCollapse` → all pass

**Steps:**

- [ ] **Step 1: Create LongTextCollapse component**

Create `apps/client/src/components/channel/LongTextCollapse.tsx`:

```tsx
import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useFullContent } from "@/hooks/useMessages";
import type { Message } from "@/types/im";

interface LongTextCollapseProps {
  message: Message;
  children: React.ReactNode;
}

// Approximate height for 10 lines of message content
const COLLAPSED_MAX_HEIGHT = "15rem"; // ~10 lines at 1.5rem line height

export function LongTextCollapse({ message, children }: LongTextCollapseProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [fetchEnabled, setFetchEnabled] = useState(false);

  const {
    data: fullContentData,
    isLoading,
    isError,
  } = useFullContent(message.id, fetchEnabled && !!message.isTruncated);

  const remainingChars = message.fullContentLength
    ? message.fullContentLength - (message.content?.length ?? 0)
    : 0;

  const handleExpand = useCallback(() => {
    if (message.isTruncated) {
      // Need to fetch full content first
      setFetchEnabled(true);
    }
    setIsExpanded(true);
  }, [message.isTruncated]);

  const handleRetry = useCallback(() => {
    setFetchEnabled(false);
    // Re-enable on next tick to trigger refetch
    setTimeout(() => setFetchEnabled(true), 0);
  }, []);

  // When full content is loaded and we're waiting for it, content is ready
  const isContentReady = !message.isTruncated || !!fullContentData;
  const showExpanded = isExpanded && (isContentReady || isLoading);

  return (
    <div className="relative">
      {/* Content area with conditional height constraint */}
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
        style={{
          maxHeight:
            isExpanded && isContentReady ? "none" : COLLAPSED_MAX_HEIGHT,
        }}
      >
        {/* Render children with potentially replaced content */}
        {isExpanded && fullContentData
          ? // Re-render children won't work here — we need to pass content down.
            // This is handled by MessageContent which reads fullContent from cache.
            children
          : children}
      </div>

      {/* Gradient overlay when collapsed */}
      {!isExpanded && (
        <div
          className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
          style={{
            background: "linear-gradient(transparent, hsl(var(--background)))",
          }}
        />
      )}

      {/* Expand button */}
      {!isExpanded && (
        <button
          type="button"
          onClick={handleExpand}
          className="mt-1 flex items-center gap-1 text-xs text-info hover:text-info/80 transition-colors"
        >
          <ChevronDown size={14} />
          <span>
            展开全文
            {remainingChars > 0 &&
              `（还有约 ${formatCharCount(remainingChars)} 字）`}
          </span>
        </button>
      )}

      {/* Loading state */}
      {isExpanded && isLoading && !isContentReady && (
        <div className="mt-1 text-xs text-muted-foreground">加载中...</div>
      )}

      {/* Error state */}
      {isExpanded && isError && (
        <button
          type="button"
          onClick={handleRetry}
          className="mt-1 text-xs text-destructive hover:text-destructive/80 transition-colors"
        >
          加载失败，点击重试
        </button>
      )}
    </div>
  );
}

function formatCharCount(count: number): string {
  if (count >= 10000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}
```

- [ ] **Step 2: Update MessageContent to support LongTextCollapse**

In `apps/client/src/components/channel/MessageContent.tsx`, update the props and rendering:

Update the `MessageContentProps` interface:

```typescript
interface MessageContentProps {
  content: string;
  className?: string;
  message?: Message; // Full message object for long_text support
}
```

Update the main `MessageContent` component (around line 367) to wrap in `LongTextCollapse`:

```typescript
export function MessageContent({ content, className, message }: MessageContentProps) {
  const isHtml = HTML_TAG_PATTERN.test(content);

  // If expanded and full content is cached, use it
  const fullContentQuery = message?.type === 'long_text'
    ? queryClient.getQueryData<{ content: string }>(['message-full-content', message.id])
    : undefined;
  const displayContent = fullContentQuery?.content ?? content;

  const contentElement = useMemo(
    () =>
      isHtml ? (
        <HtmlMessageContent content={displayContent} className={className} />
      ) : (
        <MarkdownMessageContent content={displayContent} className={className} />
      ),
    [isHtml, displayContent, className],
  );

  const wrappedContent = (
    // ... existing wrapper with selection copy etc.
  );

  if (message?.type === 'long_text') {
    return (
      <LongTextCollapse message={message}>
        {wrappedContent}
      </LongTextCollapse>
    );
  }

  return wrappedContent;
}
```

Add imports:

```typescript
import { LongTextCollapse } from "./LongTextCollapse";
import type { Message } from "@/types/im";
```

- [ ] **Step 3: Update MessageItem to pass message object**

In `apps/client/src/components/channel/MessageItem.tsx`, update the MessageContent usage (around line 244):

```typescript
    <MessageContent
      content={message.content}
      className="text-sm whitespace-pre-wrap break-words"
      message={message}
    />
```

- [ ] **Step 4: Write component tests**

Create `apps/client/src/components/channel/__tests__/LongTextCollapse.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LongTextCollapse } from "../LongTextCollapse";
import type { Message } from "@/types/im";

// Mock useFullContent hook
vi.mock("@/hooks/useMessages", () => ({
  useFullContent: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
  })),
}));

// Mock framer-motion
vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: any) => children,
  motion: { div: (props: any) => <div {...props} /> },
}));

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: "msg-1",
  channelId: "ch-1",
  senderId: "user-1",
  content: "Preview content here...",
  type: "long_text",
  isPinned: false,
  isEdited: false,
  isDeleted: false,
  createdAt: "2026-04-11T00:00:00Z",
  updatedAt: "2026-04-11T00:00:00Z",
  isTruncated: false,
  fullContentLength: 5000,
  ...overrides,
});

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("LongTextCollapse", () => {
  it("renders children in collapsed state with gradient", () => {
    renderWithQuery(
      <LongTextCollapse message={makeMessage()}>
        <div data-testid="content">Hello</div>
      </LongTextCollapse>,
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(screen.getByText(/展开全文/)).toBeInTheDocument();
  });

  it("shows remaining character count", () => {
    renderWithQuery(
      <LongTextCollapse message={makeMessage({ fullContentLength: 5000 })}>
        <div>Content (200 chars)</div>
      </LongTextCollapse>,
    );
    expect(screen.getByText(/还有约/)).toBeInTheDocument();
  });

  it("expands in place when content is not truncated", () => {
    renderWithQuery(
      <LongTextCollapse message={makeMessage({ isTruncated: false })}>
        <div data-testid="content">Full content</div>
      </LongTextCollapse>,
    );
    fireEvent.click(screen.getByText(/展开全文/));
    // After expand, button should be gone
    expect(screen.queryByText(/展开全文/)).not.toBeInTheDocument();
  });

  it("shows loading state when fetching truncated content", async () => {
    const { useFullContent } = await import("@/hooks/useMessages");
    (useFullContent as any).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderWithQuery(
      <LongTextCollapse message={makeMessage({ isTruncated: true })}>
        <div>Content</div>
      </LongTextCollapse>,
    );
    fireEvent.click(screen.getByText(/展开全文/));
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("shows error state with retry", async () => {
    const { useFullContent } = await import("@/hooks/useMessages");
    (useFullContent as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderWithQuery(
      <LongTextCollapse message={makeMessage({ isTruncated: true })}>
        <div>Content</div>
      </LongTextCollapse>,
    );
    fireEvent.click(screen.getByText(/展开全文/));
    expect(screen.getByText("加载失败，点击重试")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run tests**

Run: `cd apps/client && pnpm vitest run --testPathPattern=LongTextCollapse`
Expected: All tests pass.

- [ ] **Step 6: Verify full client build**

Run: `pnpm build:client`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/components/channel/LongTextCollapse.tsx \
  apps/client/src/components/channel/__tests__/LongTextCollapse.test.tsx \
  apps/client/src/components/channel/MessageContent.tsx \
  apps/client/src/components/channel/MessageItem.tsx
git commit -m "feat(client): add LongTextCollapse component with gradient preview and expand"
```

---

### Task 6: End-to-End Verification & Error Feedback

**Goal:** Verify the full flow works end-to-end, ensure error messages are surfaced to users, and add missing error toast for failed sends.

**Files:**

- Modify: `apps/client/src/hooks/useMessages.ts` (onError handler)

**Acceptance Criteria:**

- [ ] Sending a 5000-char message creates a `long_text` type
- [ ] The message appears collapsed in chat with "展开全文" button
- [ ] Clicking expand shows full content (no network request if under API truncation limit)
- [ ] Sending a 50000-char message truncates at API level, expand fetches via network
- [ ] Editing a long_text message to short text changes type back to `text`
- [ ] Error toast shown when send fails (including length validation)
- [ ] Full build passes: `pnpm build`

**Verify:** `pnpm build` → success; manual testing in dev environment

**Steps:**

- [ ] **Step 1: Add error toast on send failure**

In `apps/client/src/hooks/useMessages.ts`, in `useSendMessage`'s `onError` (around line 1663), add a toast notification:

```typescript
    onError: (err, variables, context) => {
      // Show error toast with server message
      const errorMessage = err instanceof Error
        ? err.message
        : 'Failed to send message';
      // Use the app's toast system
      toast.error(errorMessage);

      if (variables.clientMsgId) {
        pendingByClientMsgId.delete(variables.clientMsgId);
      }
      // ... existing rollback logic
    },
```

Check what toast library the project uses (likely sonner or react-hot-toast) and use the correct import.

- [ ] **Step 2: Run full build**

Run: `pnpm build`
Expected: Both server and client build successfully.

- [ ] **Step 3: Run all tests**

Run: `cd apps/server && pnpm jest` and `cd apps/client && pnpm vitest run`
Expected: All existing + new tests pass.

- [ ] **Step 4: Manual smoke test**

Start dev environment: `pnpm dev`

Test scenarios:

1. Send a short message → appears as normal `text` type
2. Send a message with 2000+ chars → appears collapsed with "展开全文" button
3. Click "展开全文" → expands in place (no loading spinner for moderately long messages)
4. Send a very long message (10000+ chars) → appears collapsed, expand triggers network fetch
5. Edit a long_text message to a short one → type changes to `text`, no longer collapsed
6. Try sending 100001 chars → blocked with error toast

- [ ] **Step 5: Final commit**

```bash
git add apps/client/src/hooks/useMessages.ts
git commit -m "feat(client): add error toast on message send failure"
```

</content>
</invoke>
