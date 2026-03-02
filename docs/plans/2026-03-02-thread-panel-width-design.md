# Thread Panel Smart Width Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make thread panels wider (420px) and auto-expand to fill available space when the main chat area gets too narrow (snap mode).

**Architecture:** `ChannelView` monitors its main chat container width via `ResizeObserver`. When thread panels squeeze the main chat below 400px, it hides the main chat and lets thread panels flex-fill. A "back to channel" button in the thread header allows returning. The `isSnapped` state is passed to `ThreadPanel` as a prop to toggle between fixed and flex width.

**Tech Stack:** React, Tailwind CSS, ResizeObserver API, Zustand (existing useThreadStore), i18n

---

### Task 1: Update ThreadPanel base width from w-96 to w-105

**Files:**

- Modify: `apps/client/src/components/channel/ThreadPanel.tsx:280`

**Step 1: Change width class**

In `ThreadPanel.tsx`, line 280, change the root div class:

```tsx
// Before:
<div className="w-96 border-l bg-background flex flex-col h-full">

// After:
<div className="w-105 border-l bg-background flex flex-col h-full">
```

**Step 2: Verify visually**

Run: `pnpm dev:client`
Open a channel, open a thread. Confirm the panel is wider than before (420px vs 384px).

**Step 3: Commit**

```bash
git add apps/client/src/components/channel/ThreadPanel.tsx
git commit -m "feat(thread): increase panel width from 384px to 420px"
```

---

### Task 2: Add isSnapped prop to ThreadPanel for flex-fill mode

**Files:**

- Modify: `apps/client/src/components/channel/ThreadPanel.tsx:36-41,279-290`

**Step 1: Add isSnapped and onBackToChannel props**

Update the `ThreadPanelProps` interface and destructure the new props:

```tsx
interface ThreadPanelProps {
  level: ThreadLevel;
  rootMessageId: string;
  highlightMessageId?: string;
  isSnapped?: boolean;
  onBackToChannel?: () => void;
}

export function ThreadPanel({
  level,
  rootMessageId,
  highlightMessageId,
  isSnapped = false,
  onBackToChannel,
}: ThreadPanelProps) {
```

**Step 2: Toggle width class based on isSnapped**

Change the root div to use conditional class:

```tsx
<div className={`${isSnapped ? "flex-1" : "w-105"} border-l bg-background flex flex-col h-full transition-all duration-200`}>
```

**Step 3: Add back-to-channel button in header when snapped**

In the header section (around line 282-289), add a back button before the title when `isSnapped` and `onBackToChannel` are provided:

```tsx
{
  /* Header */
}
<div className="flex items-center justify-between px-4 py-3 border-b">
  <div className="flex items-center gap-2">
    {isSnapped && onBackToChannel && (
      <Button
        variant="ghost"
        size="icon"
        onClick={onBackToChannel}
        className="mr-1"
      >
        <ArrowLeft size={20} />
      </Button>
    )}
    <MessageSquare size={20} className="text-muted-foreground" />
    <h2 className="font-semibold">{t("title")}</h2>
  </div>
  <Button variant="ghost" size="icon" onClick={closeThread}>
    <X size={20} />
  </Button>
</div>;
```

Add `ArrowLeft` to the lucide-react import at line 3:

```tsx
import { X, MessageSquare, Loader2, ArrowDown, ArrowLeft } from "lucide-react";
```

**Step 4: Commit**

```bash
git add apps/client/src/components/channel/ThreadPanel.tsx
git commit -m "feat(thread): add isSnapped prop for flex-fill mode with back button"
```

---

### Task 3: Add i18n keys for back-to-channel button

**Files:**

- Modify: `apps/client/src/i18n/locales/en/thread.json`
- Modify: `apps/client/src/i18n/locales/zh/thread.json`

**Step 1: Add English key**

Add to `en/thread.json`:

```json
"backToChannel": "Back to channel"
```

**Step 2: Add Chinese key**

Add to `zh/thread.json`:

```json
"backToChannel": "返回频道"
```

**Step 3: Commit**

```bash
git add apps/client/src/i18n/locales/en/thread.json apps/client/src/i18n/locales/zh/thread.json
git commit -m "feat(i18n): add thread backToChannel translation keys"
```

---

### Task 4: Add ResizeObserver snap detection to ChannelView

**Files:**

- Modify: `apps/client/src/components/channel/ChannelView.tsx:1,57-63,268-353`

**Step 1: Add state and ref for snap mode**

Add imports and state inside `ChannelView`:

```tsx
// Add useRef to existing import (line 1):
import { useEffect, useMemo, useState, useCallback, useRef } from "react";

// Inside ChannelView function, after existing state declarations:
const mainChatRef = useRef<HTMLDivElement>(null);
const [isSnapped, setIsSnapped] = useState(false);
```

**Step 2: Add ResizeObserver effect**

Add this effect inside `ChannelView`, after the existing `useEffect` blocks (e.g., after the `markAsRead` effect around line 239):

```tsx
// Monitor main chat area width for snap mode
const hasThreadOpen = primaryThread.isOpen || secondaryThread.isOpen;

useEffect(() => {
  const el = mainChatRef.current;
  if (!el || !hasThreadOpen) {
    setIsSnapped(false);
    return;
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.contentRect.width;
      setIsSnapped(width < 400);
    }
  });

  observer.observe(el);
  return () => observer.disconnect();
}, [hasThreadOpen]);
```

**Step 3: Add onBackToChannel handler**

```tsx
const handleBackToChannel = useCallback(() => {
  closePrimaryThread();
}, [closePrimaryThread]);
```

Note: `closePrimaryThread` already closes both primary and secondary threads (see `useThread.ts:101-106`).

**Step 4: Update the JSX layout**

Replace the return JSX (lines 268-353) with snap-aware layout:

```tsx
return (
  <div className="h-full flex">
    {/* Main channel content - hidden in snap mode */}
    <div
      ref={mainChatRef}
      className={`flex-1 flex flex-col min-w-0 ${isSnapped ? "hidden" : ""}`}
    >
      <ChannelHeader channel={channel} currentUserRole={currentUserRole} />

      {/* ... existing message list / overlay / input content stays the same ... */}
    </div>

    {/* Thread panel sidebars - up to 2 layers (hidden for direct messages) */}
    {channel?.type !== "direct" &&
      primaryThread.isOpen &&
      primaryThread.rootMessageId && (
        <ThreadPanel
          level="primary"
          rootMessageId={primaryThread.rootMessageId}
          highlightMessageId={initialThreadId ? initialMessageId : undefined}
          isSnapped={isSnapped}
          onBackToChannel={handleBackToChannel}
        />
      )}
    {channel?.type !== "direct" &&
      secondaryThread.isOpen &&
      secondaryThread.rootMessageId && (
        <ThreadPanel
          level="secondary"
          rootMessageId={secondaryThread.rootMessageId}
          isSnapped={isSnapped}
          onBackToChannel={handleBackToChannel}
        />
      )}
  </div>
);
```

Key changes:

1. Add `ref={mainChatRef}` to the main chat container
2. Add `isSnapped ? "hidden" : ""` to conditionally hide main chat
3. Pass `isSnapped` and `onBackToChannel` to both ThreadPanel instances

**Step 5: Commit**

```bash
git add apps/client/src/components/channel/ChannelView.tsx
git commit -m "feat(thread): add ResizeObserver snap mode for thread panels"
```

---

### Task 5: Manual verification and edge cases

**Step 1: Test single panel on large screen (1920px+)**

- Open a thread in a channel
- Thread panel should be 420px, main chat visible
- No snap mode triggered

**Step 2: Test dual panels on medium screen (1440px)**

- Open a primary thread, then open a nested secondary thread
- Main chat should snap to hidden
- Both thread panels should expand to fill available space (flex-1, split evenly)
- "Back to channel" arrow button should appear in both panel headers

**Step 3: Test back-to-channel button**

- In snap mode, click the back arrow button
- Both thread panels should close
- Main chat should reappear

**Step 4: Test window resize**

- Open dual threads on a large monitor (no snap)
- Resize the browser window smaller
- Snap mode should activate smoothly
- Resize back — snap mode should deactivate, main chat reappears

**Step 5: Test direct message channels**

- Open a DM channel — thread panels should not appear (existing behavior, unchanged)

**Step 6: Commit if any fixes needed**

```bash
git add -u
git commit -m "fix(thread): address edge cases in snap mode"
```
