# Bot Startup Wait Step Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `wait-for-bot` step to the aHand setup dialog that waits for the OpenClaw bot instance to be running before proceeding, with a 150s countdown and early exit on bot online.

**Architecture:** Insert a new step + handler in the existing aHand setup step system. The handler polls `getOpenClawStatus` every 5s and listens for WebSocket `user_online`. A new `botCountdown` store field drives the UI countdown display.

**Tech Stack:** Zustand store, WebSocket service (singleton), applicationsApi

---

### Task 1: Add `wait-for-bot` step definition and store state

**Files:**

- Modify: `apps/client/src/stores/useAHandSetupStore.ts`

**Step 1: Add the new step to `createInitialSteps()`**

Insert after `find-app`, before `gateway-info`:

```ts
  {
    id: "wait-for-bot",
    group: "ahand",
    label: "Wait for bot instance",
    status: "pending",
  },
```

**Step 2: Add `botCountdown` state and action to the store**

Add to the `AHandSetupState` interface:

```ts
  botCountdown: number;
  setBotCountdown: (seconds: number) => void;
```

Add initial value `botCountdown: 0` in the store creator.

Add `setBotCountdown` action:

```ts
setBotCountdown: (seconds) =>
  set({ botCountdown: seconds }, false, "setBotCountdown"),
```

Reset `botCountdown: 0` in the existing `reset()` action.

**Step 3: Verify no type errors**

Run: `cd apps/client && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to `botCountdown` or `wait-for-bot`.

---

### Task 2: Implement `wait-for-bot` handler

**Files:**

- Modify: `apps/client/src/stores/useAHandSetupStore.ts`

**Step 1: Add imports**

Add at the top of the file:

```ts
import wsService from "../services/websocket/index.js";
```

The `applicationsApi` import already exists via the `applications.js` alias.

**Step 2: Add the handler to `stepHandlers`**

Insert `"wait-for-bot"` handler after `"find-app"`:

```ts
"wait-for-bot": async (ctx) => {
  if (!ctx.appId) throw new Error("Missing app ID from previous step");

  const BOT_STARTUP_DURATION = 150;
  const POLL_INTERVAL_MS = 5000;

  // Check if already running
  try {
    const status = await applicationsApi.getOpenClawStatus(ctx.appId);
    if (status.status === "running") {
      return; // Instance already up, skip wait
    }
  } catch {
    // Instance may not exist yet (404) — proceed to wait
  }

  // Try to get bot userId for WebSocket early-exit
  let botUserId: string | null = null;
  try {
    const bots = await applicationsApi.getOpenClawBots(ctx.appId);
    botUserId = bots[0]?.userId ?? null;
  } catch {
    // Bots may not be available yet — polling alone is fine
  }

  const store = useAHandSetupStore.getState;

  return new Promise<void>((resolve, reject) => {
    let remaining = BOT_STARTUP_DURATION;
    store().setBotCountdown(remaining);

    // Countdown timer (every 1s)
    const countdownTimer = setInterval(() => {
      remaining -= 1;
      store().setBotCountdown(remaining);
      if (remaining <= 0) {
        cleanup();
        reject(
          new Error(
            "Bot instance did not start within the expected time. Please retry.",
          ),
        );
      }
    }, 1000);

    // Poll instance status (every 5s)
    const pollTimer = setInterval(async () => {
      try {
        const status = await applicationsApi.getOpenClawStatus(ctx.appId!);
        if (status.status === "running") {
          cleanup();
          resolve();
        }
      } catch {
        // Keep polling — transient errors are expected during startup
      }
    }, POLL_INTERVAL_MS);

    // WebSocket listener for bot coming online
    const handleUserOnline = (event: { userId: string }) => {
      if (botUserId && event.userId === botUserId) {
        cleanup();
        resolve();
      }
    };
    if (botUserId) {
      wsService.onUserOnline(handleUserOnline);
    }

    function cleanup() {
      clearInterval(countdownTimer);
      clearInterval(pollTimer);
      store().setBotCountdown(0);
      if (botUserId) {
        wsService.off("user_online", handleUserOnline);
      }
    }
  });
},
```

**Step 3: Verify no type errors**

Run: `cd apps/client && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 4: Commit**

```bash
git add apps/client/src/stores/useAHandSetupStore.ts
git commit -m "feat(client): add wait-for-bot step to aHand setup"
```

---

### Task 3: Update AHandSetupDialog to show countdown

**Files:**

- Modify: `apps/client/src/components/dialog/AHandSetupDialog.tsx`

**Step 1: Show countdown in StepRow for wait-for-bot step**

Update `StepRow` to accept and display countdown:

```tsx
function StepRow({ step }: { step: SetupStep }) {
  const retryFrom = useAHandSetupStore((s) => s.retryFrom);
  const botCountdown = useAHandSetupStore((s) => s.botCountdown);

  const showCountdown =
    step.id === "wait-for-bot" && step.status === "running" && botCountdown > 0;

  return (
    <div>
      <div className="flex items-center gap-2">
        <StepIcon status={step.status} />
        <span
          className={
            step.status === "pending"
              ? "text-sm text-muted-foreground/60"
              : step.status === "error"
                ? "text-sm text-red-500"
                : "text-sm"
          }
        >
          {step.label}
        </span>
        {showCountdown && (
          <span className="ml-auto text-sm font-bold tabular-nums text-primary">
            {botCountdown}s
          </span>
        )}
        {step.status === "error" && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-xs"
            onClick={() => retryFrom(step.id)}
          >
            Retry
          </Button>
        )}
      </div>
      {step.status === "error" && step.error && (
        <div className="pl-6 text-xs text-red-400 whitespace-pre-line">
          {step.error}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify no type errors**

Run: `cd apps/client && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/client/src/components/dialog/AHandSetupDialog.tsx
git commit -m "feat(client): show bot startup countdown in aHand setup dialog"
```

---

### Task 4: Manual verification

**Step 1: Start dev server**

Run: `pnpm dev:desktop`

**Step 2: Verify flow**

1. Log in as a new user (or clear aHand setup state)
2. aHand setup dialog should open
3. `find-app` step completes
4. `wait-for-bot` step shows spinner + countdown (e.g. "Wait for bot instance 142s")
5. When bot instance becomes running, step completes and flow continues to `gateway-info`
6. If bot was already running, `wait-for-bot` completes instantly

**Step 3: Verify retry**

1. Disconnect network during `wait-for-bot`
2. Let countdown expire → should show error with Retry button
3. Click Retry → should restart from `wait-for-bot`
