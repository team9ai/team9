# Bot Startup Wait Step in aHand Setup Dialog

## Problem

When a new user registers and logs into Team9 (desktop), the aHand setup dialog auto-starts immediately. However, the OpenClaw bot instance takes ~120s to provision. The `gateway-info` step fails with 503 because the instance isn't running yet, showing the user an error instead of a meaningful wait prompt.

## Solution

Add a `wait-for-bot` step between `find-app` and `gateway-info` in the aHand setup flow. This step polls the instance status with a 150s countdown, and can end early when the bot comes online.

## Design

### Step Position

```
find-app → [wait-for-bot (NEW)] → gateway-info → node-id → ...
```

### New Step Definition

```ts
{
  id: "wait-for-bot",
  group: "ahand",
  label: "Wait for bot instance",
  status: "pending",
}
```

### Handler Logic (`wait-for-bot`)

1. Call `applicationsApi.getOpenClawStatus(appId)` using `ctx.appId` from previous step.
2. If `status === "running"`, resolve immediately (skip wait).
3. Otherwise enter poll + countdown:
   - 150s total duration, poll `getOpenClawStatus` every 5s.
   - Call `applicationsApi.getOpenClawBots(appId)` once to get bot `userId` for WebSocket monitoring.
   - Listen to `wsService.onUserOnline(botUserId)` for early exit.
   - When status becomes `"running"` or bot comes online, resolve.
   - On 150s timeout, throw error (user can retry).
4. Cleanup: clear timer and WebSocket listener on resolve/reject.

### Store Changes

Add `botCountdown: number` field and `setBotCountdown` action to `AHandSetupState`. The handler updates this every second via `setInterval`.

### UI Changes (AHandSetupDialog.tsx)

When `wait-for-bot` is running, the `StepRow` shows the countdown:

```
⏳ Wait for bot instance   120s
```

Uses existing `Loader2` spinner icon. Countdown displayed to the right of the label.

## Files Modified

1. `apps/client/src/stores/useAHandSetupStore.ts` — new step, handler, countdown state
2. `apps/client/src/components/dialog/AHandSetupDialog.tsx` — countdown display in StepRow
