# Long Text Message Feature Design

**Date:** 2026-04-11
**Status:** Approved

## Problem

Team9 currently limits message content to 10,000 characters (`@MaxLength(10000)`). Users sending long text — especially to AI bots (code blocks, detailed prompts) — hit this limit silently. The HTML serialization from the Lexical editor inflates content size, so users perceive the limit as even lower. Additionally, long messages broadcast via WebSocket to all channel members cause unnecessary bandwidth usage.

## Solution Overview

Add a `long_text` message type with automatic detection, truncated broadcast, on-demand full content retrieval, and a collapsible UI with gradient fade-out.

## Design Decisions

| Decision                 | Outcome                                                  |
| ------------------------ | -------------------------------------------------------- |
| Message type             | New `long_text` DB enum value                            |
| Trigger threshold        | Lines >= 20 OR characters >= 2000 (either triggers)      |
| Max content length       | 100,000 characters                                       |
| Storage                  | Database `text` column (no external file storage)        |
| Collapsed style          | Gradient fade-out + "展开全文 (还有约 X 字)" button      |
| Preview lines (frontend) | ~10 lines (future: window-adaptive + user configurable)  |
| Preview content (API/WS) | 20 lines OR 3000 chars (whichever comes first)           |
| Expand behavior          | In-place expand, no collapse back (future: sidebar view) |
| Full content endpoint    | `GET /messages/:id/full-content`                         |
| Cache invalidation       | Invalidate on `message_updated` WebSocket event          |

## Architecture

### 1. Database & Type System

**Schema changes:**

- `messageTypeEnum`: add `'long_text'` value
- `content` column: unchanged (already `text` type, no limit)
- Requires a Drizzle migration

**DTO changes:**

- `CreateMessageDto.content`: `@MaxLength(10000)` → `@MaxLength(100000)`
- `UpdateMessageDto.content`: `@MaxLength(10000)` → `@MaxLength(100000)`
- No new DTO fields — type is determined server-side

**Type detection logic (server, in messages controller):**

```
function determineMessageType(content, hasAttachments):
  if hasAttachments: return 'file'
  lineCount = countLogicalLines(content)  // HTML block elements + \n in <pre>
  if lineCount >= 20 OR content.length >= 2000:
    return 'long_text'
  return 'text'
```

Line counting considers HTML structure: `<p>`, `<br>`, `\n` inside `<pre>` blocks. For Markdown content (bot messages), plain `\n` splitting.

This logic also runs on message edit — type can upgrade/downgrade based on new content.

**Client type definition:**

- `MessageType`: add `'long_text'` to union type

### 2. Truncated Broadcast & Full Content API

**Two-layer truncation:**

| Layer           | Truncation             | Purpose                                             |
| --------------- | ---------------------- | --------------------------------------------------- |
| API / WebSocket | 20 lines OR 3000 chars | Reduce payload, cover most "slightly long" messages |
| Frontend render | ~10 lines via CSS      | Visual collapse with gradient                       |

**Message response additions (for `long_text` type):**

- `isTruncated: boolean` — whether the returned content was truncated at the API layer
- `fullContentLength: number` — character count of the full content

**Truncation location:**

- New `truncateForPreview(message)` method in `MessagesService`
- Called before:
  - WebSocket broadcast (`sendToChannelMembers`)
  - Message list endpoint `GET /channels/:channelId/messages`
  - Single message endpoint `GET /messages/:id`

**Full content endpoint:**

```
GET /api/v1/im/messages/:id/full-content

Auth: JwtAuthGuard
Validation: requester must be a member of the message's channel

Response: { content: string }
```

**Frontend expand logic:**

```
on "展开全文" click:
  if !message.isTruncated:
    expand in-place using existing content (zero network request)
  else:
    fetch GET /messages/:id/full-content
    replace content, then expand
```

**React Query caching:**

- Cache key: `['message-full-content', messageId]`
- `staleTime: Infinity` (content doesn't change unless edited)
- On `message_updated` WebSocket event: `invalidateQueries(['message-full-content', messageId])`

### 3. Frontend Rendering & Interaction

**Component structure:**

`MessageContent.tsx` wraps content in `LongTextCollapse` when `type === 'long_text'`:

```
<LongTextCollapse message={message}>
  <HtmlMessageContent /> or <MarkdownMessageContent />
</LongTextCollapse>
```

**LongTextCollapse component (new):**

- **Collapsed state:**
  - CSS `max-height` limiting to ~10 lines (calculated from `line-height`)
  - `overflow: hidden`
  - Bottom `linear-gradient` mask fading to background
  - Button: "展开全文（还有约 X 字）↓"
  - Remaining chars = `fullContentLength - content.length` (works for both truncated and non-truncated cases, since `content` is always the API-returned preview and `fullContentLength` is always the true total)

- **Expand click:**
  - If `!isTruncated`: remove `max-height`, animate expand
  - If `isTruncated`: show "加载中..." on button, fetch full-content, replace content, expand

- **Expanded state:**
  - Button and gradient disappear
  - Full content displayed
  - No collapse-back (future enhancement)
  - State resets on refresh / channel switch (not persisted)

- **State management:** Component-local `useState`, no global store needed

**Impact on existing components:**

- `MessageItem.tsx`: pass message type and new fields to `MessageContent`
- `MessageContent.tsx`: accept new props, conditionally wrap with `LongTextCollapse`
- Other message types: no impact

### 4. Server Configuration & Limits

**Express body parser:**

- `main.ts`: configure JSON body limit to **1MB** (from default 100KB)
- Covers 100,000 chars of HTML content + metadata

**Socket.io:**

- `@WebSocketGateway` decorator: set `maxHttpBufferSize: 1_000_000` (1MB)
- Defense-in-depth — broadcast is already truncated

**gRPC:**

- Gateway gRPC client and IM Worker gRPC server: explicitly set `maxReceiveMessageLength` / `maxSendMessageLength` to **4MB**
- Currently relies on defaults; make explicit

### 5. Error Handling & Edge Cases

**Client-side pre-validation:**

- Before sending: if content > 100,000 chars, block send and toast "消息内容过长，请缩减后重试"

**Server validation error feedback:**

- On send failure: toast the server error message (e.g., "content must be shorter than or equal to 100000 characters")
- Currently `onError` only marks message as `failed` with no reason shown

**Full-content endpoint errors:**

- Network failure: button shows "加载失败，点击重试"
- 403: defensive toast (shouldn't happen if user can see the message)

**Line counting edge cases:**

- Empty message: cannot trigger `long_text` (0 lines, 0 chars)
- Pure code block: `\n` inside `<pre>` counts as lines — large code blocks can trigger `long_text`
- Markdown content (bot messages): split by `\n` for line count, same thresholds

**Message editing:**

- Edit that shortens below threshold: type downgrades to `text`
- Edit that exceeds threshold: type upgrades to `long_text`
- Type is re-determined on every edit

## Future Enhancements

- **Window-adaptive preview lines**: auto-adjust collapsed height based on viewport
- **User-configurable preview**: settings to control default collapsed line count
- **Sidebar/modal full view**: "Open in sidebar" button for very long messages
- **Streaming long messages**: handle bot streaming responses that exceed threshold mid-stream
