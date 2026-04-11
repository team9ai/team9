# PostHog Analytics Priority 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostHog config changes (cookie_domain, register, flush) and Tier 1 growth events + key backend events to the team9 App.

**Architecture:** Modify PostHog client initialization for cross-subdomain identity stitching and super properties. Add `capture()` calls at key frontend interaction points. Inject `PosthogService` into backend services and add server-side event captures. Remove unused GTM code.

**Tech Stack:** posthog-js (frontend), posthog-node (backend), NestJS DI, React hooks, Drizzle ORM

**Spec:** `docs/superpowers/specs/2026-04-10-analytics-strategy-design.md`

---

## File Structure

### Modified files

| File                                                          | Responsibility                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/client/src/analytics/posthog/client.ts`                 | Add `cookie_domain`, `posthog.register()` with app metadata                          |
| `apps/client/src/analytics/posthog/config.ts`                 | Export app version constant                                                          |
| `apps/client/src/main.tsx`                                    | Remove GTM imports and initialization                                                |
| `apps/client/src/routes/login.tsx`                            | Add `sign_up_completed` capture + `posthog.flush()` before desktop deep link         |
| `apps/client/src/routes/verify-email.tsx`                     | Add `posthog.flush()` before desktop deep link                                       |
| `apps/client/src/routes/_authenticated/onboarding.tsx`        | Add `onboarding_step` + `workspace_created` + `member_invited` captures              |
| `apps/client/src/components/dialog/CreateWorkspaceDialog.tsx` | Add `workspace_created` capture                                                      |
| `apps/client/src/hooks/useMessages.ts`                        | Add `message_sent` capture (every message, used for `first_message_sent` by backend) |
| `apps/server/libs/posthog/src/posthog.service.ts`             | Auto-inject `app_name: "team9-server"` into all captures                             |
| `apps/server/apps/gateway/src/workspace/workspace.service.ts` | Inject PosthogService, add `workspace_member_joined` + `invite_accepted` captures    |
| `apps/client/package.json`                                    | Remove `react-gtm-module` + `@types/react-gtm-module`                                |

---

### Task 1: PostHog client config — cookie_domain + register

**Files:**

- Modify: `apps/client/src/analytics/posthog/client.ts`
- Modify: `apps/client/src/analytics/posthog/config.ts`

- [ ] **Step 1: Update config.ts to export app version**

```typescript
// apps/client/src/analytics/posthog/config.ts — add at the end of the file

export const TEAM9_APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined) || "0.1.0";
```

- [ ] **Step 2: Update client.ts to add cookie_domain and register()**

Replace the full content of `apps/client/src/analytics/posthog/client.ts`:

```typescript
import type { PostHog } from "posthog-js";
import { posthogBrowserConfig, TEAM9_APP_VERSION } from "./config";

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let posthogClientPromise: Promise<PostHog | null> | null = null;

export const getPostHogBrowserClient = (): Promise<PostHog | null> => {
  const config = posthogBrowserConfig;

  if (!config) {
    return Promise.resolve(null);
  }

  if (!posthogClientPromise) {
    posthogClientPromise = import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(config.key, {
          api_host: config.host,
          defaults: "2026-01-30",
          cookie_domain: IS_TAURI ? undefined : ".team9.ai",
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          capture_dead_clicks: false,
          capture_exceptions: false,
          capture_heatmaps: false,
          disable_external_dependency_loading: true,
          disable_session_recording: true,
          disable_surveys: true,
          advanced_disable_flags: true,
          advanced_disable_toolbar_metrics: true,
          mask_all_element_attributes: true,
          mask_all_text: true,
          debug: import.meta.env.DEV,
        });

        posthog.register({
          app_name: "team9-app",
          app_version: TEAM9_APP_VERSION,
          app_platform: IS_TAURI ? "desktop" : "web",
        });

        return posthog;
      })
      .catch((error) => {
        console.error("[PostHog] Failed to initialize browser client", error);
        posthogClientPromise = null;
        return null;
      });
  }

  return posthogClientPromise;
};
```

- [ ] **Step 3: Verify build passes**

Run: `cd apps/client && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/analytics/posthog/client.ts apps/client/src/analytics/posthog/config.ts
git commit -m "feat(analytics): add cookie_domain and register super properties to PostHog init"
```

---

### Task 2: Remove unused GTM code

**Files:**

- Modify: `apps/client/src/main.tsx`
- Modify: `apps/client/package.json`

- [ ] **Step 1: Remove GTM import and initialization from main.tsx**

In `apps/client/src/main.tsx`, remove line 4 (`import TagManager ...`) and lines 29-33 (GTM initialization block):

Remove:

```typescript
import TagManager from "react-gtm-module";
```

Remove:

```typescript
// Initialize Google Tag Manager
const gtmId = import.meta.env.VITE_GTM_ID;
if (gtmId) {
  TagManager.initialize({ gtmId });
}
```

- [ ] **Step 2: Uninstall GTM packages**

Run: `cd apps/client && pnpm remove react-gtm-module @types/react-gtm-module`

- [ ] **Step 3: Verify build passes**

Run: `cd apps/client && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/main.tsx apps/client/package.json
git commit -m "chore(client): remove unused react-gtm-module dependency and initialization"
```

---

### Task 3: PostHog flush before desktop deep link redirect

**Files:**

- Modify: `apps/client/src/routes/login.tsx`
- Modify: `apps/client/src/routes/verify-email.tsx`

- [ ] **Step 1: Add flush before deep link in login.tsx**

In `apps/client/src/routes/login.tsx`, find the useEffect at line ~517:

```typescript
useEffect(() => {
  if (authState === "authenticated" && desktopSessionId) {
    window.location.href = `team9://auth-complete?sessionId=${desktopSessionId}`;
  }
}, [authState, desktopSessionId]);
```

Replace with:

```typescript
useEffect(() => {
  if (authState === "authenticated" && desktopSessionId) {
    const redirect = () => {
      window.location.href = `team9://auth-complete?sessionId=${desktopSessionId}`;
    };

    // Flush pending PostHog events (especially identify) before navigating away
    import("posthog-js")
      .then(({ default: posthog }) => {
        if (posthog.__loaded) {
          posthog.capture("desktop_auth_bridge_completed");
          return posthog.flush();
        }
      })
      .then(redirect)
      .catch(redirect);
  }
}, [authState, desktopSessionId]);
```

- [ ] **Step 2: Add flush before deep link in verify-email.tsx**

In `apps/client/src/routes/verify-email.tsx`, find line ~78:

```typescript
// Try to wake up the desktop client via deep link.
try {
  window.location.href = "team9://auth-complete";
} catch {
  // Deep link not handled, continue in browser
}
```

Replace with:

```typescript
// Flush pending PostHog events before deep link redirect
try {
  const { default: posthog } = await import("posthog-js");
  if (posthog.__loaded) {
    posthog.capture("desktop_auth_bridge_completed");
    await posthog.flush();
  }
} catch {
  // PostHog flush failed, continue anyway
}

// Try to wake up the desktop client via deep link.
try {
  window.location.href = "team9://auth-complete";
} catch {
  // Deep link not handled, continue in browser
}
```

- [ ] **Step 3: Verify build passes**

Run: `cd apps/client && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/routes/login.tsx apps/client/src/routes/verify-email.tsx
git commit -m "feat(analytics): flush PostHog events before desktop deep link redirect"
```

---

### Task 4: sign_up_completed event

**Files:**

- Modify: `apps/client/src/routes/login.tsx`

- [ ] **Step 1: Add capture in navigateAfterAuth**

In `apps/client/src/routes/login.tsx`, find the `navigateAfterAuth` function at line ~437. Add PostHog capture at the top of the function, before the desktop session check:

Find:

```typescript
const navigateAfterAuth = useCallback(async () => {
    authCompletedInSession.current = true;

    if (desktopSessionId) {
```

Replace with:

```typescript
const navigateAfterAuth = useCallback(async () => {
    authCompletedInSession.current = true;

    // Track sign up / login completion
    try {
      const { default: posthog } = await import("posthog-js");
      if (posthog.__loaded) {
        posthog.capture("sign_up_completed", {
          method: "email",
          has_invite: !!invite,
          is_desktop_flow: !!desktopSessionId,
        });
      }
    } catch {
      // Analytics should never block auth flow
    }

    if (desktopSessionId) {
```

- [ ] **Step 2: Add capture for Google OAuth success**

Search for the Google OAuth success handler in the same file. Find where Google auth completes and calls `navigateAfterAuth()` — the capture in step 1 already covers it since all auth paths go through `navigateAfterAuth`.

However, we need to distinguish the method. Find the Google success callback and add `method` context. Locate the `handleGoogleSuccess` or similar handler. Before `navigateAfterAuth()` is called from the Google path, set a ref or use the existing flow.

Since `navigateAfterAuth` is called from `useEffect` after `currentUser` changes (line ~455-458), and both email and Google flows end up setting `currentUser`, we need a way to know which method was used. Add a ref:

Find near the top of the `WebLoginView` component (around line ~390-400 area), add:

```typescript
const authMethodRef = useRef<"email" | "google">("email");
```

In the Google success handler, before verification:

```typescript
authMethodRef.current = "google";
```

Then update the capture in `navigateAfterAuth`:

```typescript
posthog.capture("sign_up_completed", {
  method: authMethodRef.current,
  has_invite: !!invite,
  is_desktop_flow: !!desktopSessionId,
});
```

- [ ] **Step 3: Verify build passes**

Run: `cd apps/client && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/routes/login.tsx
git commit -m "feat(analytics): add sign_up_completed PostHog event on auth completion"
```

---

### Task 5: onboarding_step event

**Files:**

- Modify: `apps/client/src/routes/_authenticated/onboarding.tsx`

- [ ] **Step 1: Import usePostHogAnalytics**

In `apps/client/src/routes/_authenticated/onboarding.tsx`, add import:

```typescript
import { usePostHogAnalytics } from "@/analytics/posthog/hooks";
```

- [ ] **Step 2: Add hook and capture in handleContinue**

Inside the `OnboardingRoute` component (after existing hooks around line ~130), add:

```typescript
const { capture } = usePostHogAnalytics();
```

In the `handleContinue` function (line ~689), add capture before `setCurrentStep`. Find the line:

```typescript
const nextStep = currentStep + 1;
await persistProgress({ nextStep });
setCurrentStep(nextStep);
```

Replace with:

```typescript
const nextStep = currentStep + 1;
await persistProgress({ nextStep });
capture("onboarding_step_completed", {
  step: currentStep,
  workspace_id: workspaceId,
});
setCurrentStep(nextStep);
```

Also capture the final step completion. Find where `completeOnboarding.mutateAsync` is called (line ~716):

```typescript
const result = await completeOnboarding.mutateAsync({ lang: language });
```

Add after this line:

```typescript
capture("onboarding_completed", {
  workspace_id: workspaceId,
});
```

- [ ] **Step 3: Verify build passes**

Run: `cd apps/client && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/routes/_authenticated/onboarding.tsx
git commit -m "feat(analytics): add onboarding_step_completed and onboarding_completed PostHog events"
```

---

### Task 6: workspace_created event (frontend)

**Files:**

- Modify: `apps/client/src/components/dialog/CreateWorkspaceDialog.tsx`

- [ ] **Step 1: Add capture after workspace creation**

In `apps/client/src/components/dialog/CreateWorkspaceDialog.tsx`, add import:

```typescript
import { usePostHogAnalytics } from "@/analytics/posthog/hooks";
```

Inside the component, add hook:

```typescript
const { capture } = usePostHogAnalytics();
```

In the `handleCreate` function (line ~85), find:

```typescript
const workspace = await createWorkspace.mutateAsync({
  name: name.trim(),
});
```

Add after this line:

```typescript
capture("workspace_created", {
  workspace_id: workspace.id,
});
```

- [ ] **Step 2: Verify build passes**

Run: `cd apps/client && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/dialog/CreateWorkspaceDialog.tsx
git commit -m "feat(analytics): add workspace_created PostHog event"
```

---

### Task 7: member_invited event (frontend)

**Files:**

- Modify: `apps/client/src/routes/_authenticated/onboarding.tsx`

- [ ] **Step 1: Add capture after invitation creation in onboarding**

In `apps/client/src/routes/_authenticated/onboarding.tsx`, find where `createInvitation.mutateAsync` is called. The `capture` hook is already available from Task 5.

Find the invitation creation call (around line ~1760-1785) and add capture after it:

```typescript
const invitation = await createInvitation.mutateAsync(
  DEFAULT_INVITATION_OPTIONS,
);
capture("member_invited", {
  workspace_id: workspaceId,
});
```

- [ ] **Step 2: Verify build passes**

Run: `cd apps/client && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/routes/_authenticated/onboarding.tsx
git commit -m "feat(analytics): add member_invited PostHog event in onboarding"
```

---

### Task 8: message_sent event (frontend)

**Files:**

- Modify: `apps/client/src/hooks/useMessages.ts`

- [ ] **Step 1: Add capture in useSendMessage onSuccess**

In `apps/client/src/hooks/useMessages.ts`, add import at the top:

```typescript
import { getPostHogBrowserClient } from "@/analytics/posthog/client";
```

Note: We use `getPostHogBrowserClient()` instead of the hook because `useSendMessage` is a hook itself and the capture happens in a mutation callback, not in a React component render.

In the `useSendMessage` function (line ~1464), add an `onSuccess` callback to the `useMutation` config. Find the existing mutation config and add:

```typescript
export function useSendMessage(channelId: string) {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: (data: CreateMessageDto) =>
      imApi.messages.sendMessage(channelId!, data),

    onSuccess: (_data, variables) => {
      void getPostHogBrowserClient().then((posthog) => {
        posthog?.capture("message_sent", {
          channel_id: channelId,
          workspace_id: workspaceId,
          has_attachment: (variables.attachments?.length ?? 0) > 0,
          is_thread_reply: !!variables.parentId,
        });
      });
    },

    onMutate: async (newMessageData) => {
```

- [ ] **Step 2: Verify build passes**

Run: `cd apps/client && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/hooks/useMessages.ts
git commit -m "feat(analytics): add message_sent PostHog event in useSendMessage hook"
```

---

### Task 9: Backend PosthogService — auto-inject app_name

**Files:**

- Modify: `apps/server/libs/posthog/src/posthog.service.ts`

- [ ] **Step 1: Update capture method to merge default properties**

In `apps/server/libs/posthog/src/posthog.service.ts`, find the `capture` method (line ~72):

```typescript
  capture(input: PosthogCaptureInput): void {
    if (!this.client) {
      return;
    }

    this.client.capture({
      distinctId: input.distinctId,
      event: input.event,
      properties: input.properties,
      groups: input.groups,
      disableGeoip: input.disableGeoip,
    });
  }
```

Replace with:

```typescript
  private static readonly DEFAULT_PROPERTIES: Record<string, unknown> = {
    app_name: 'team9-server',
  };

  capture(input: PosthogCaptureInput): void {
    if (!this.client) {
      return;
    }

    this.client.capture({
      distinctId: input.distinctId,
      event: input.event,
      properties: {
        ...PosthogService.DEFAULT_PROPERTIES,
        ...input.properties,
      },
      groups: input.groups,
      disableGeoip: input.disableGeoip,
    });
  }
```

- [ ] **Step 2: Verify build passes**

Run: `cd apps/server && pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/server/libs/posthog/src/posthog.service.ts
git commit -m "feat(analytics): auto-inject app_name into all PosthogService captures"
```

---

### Task 10: Backend workspace_member_joined + invite_accepted events

**Files:**

- Modify: `apps/server/apps/gateway/src/workspace/workspace.service.ts`

- [ ] **Step 1: Inject PosthogService into WorkspaceService**

In `apps/server/apps/gateway/src/workspace/workspace.service.ts`, add import:

```typescript
import { PosthogService } from "@team9/posthog";
```

In the constructor (line ~145), add `PosthogService` parameter:

Find the constructor and add as the last parameter:

```typescript
private readonly posthogService: PosthogService,
```

Note: `PosthogModule` is `@Global()`, so no module import changes needed.

- [ ] **Step 2: Add captures in acceptInvitation method**

In the `acceptInvitation` method (line ~430-749), find the end of the successful path — after the member has been inserted and broadcasts completed, just before the `return` statement. Add:

```typescript
// Analytics: track invitation acceptance and member joining
this.posthogService.capture({
  distinctId: userId,
  event: "invite_accepted",
  properties: {
    workspace_id: invitation.tenantId,
    invited_by: invitation.createdBy,
  },
  groups: { workspace: invitation.tenantId },
});

this.posthogService.capture({
  distinctId: userId,
  event: "workspace_member_joined",
  properties: {
    workspace_id: invitation.tenantId,
    role: member.role,
    invite_method: "invitation_link",
  },
  groups: { workspace: invitation.tenantId },
});
```

- [ ] **Step 3: Verify build passes**

Run: `cd apps/server && pnpm build`
Expected: No errors

- [ ] **Step 4: Verify existing tests still pass**

Run: `cd apps/server && pnpm jest --testPathPattern=workspace.service.spec`

If tests fail due to missing PosthogService in DI, update the test's module setup to provide a mock:

```typescript
{
  provide: PosthogService,
  useValue: { capture: jest.fn(), isEnabled: jest.fn().mockReturnValue(false) },
},
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/workspace/workspace.service.ts
git commit -m "feat(analytics): add invite_accepted and workspace_member_joined PostHog events"
```

---

---

## Out of Scope (Separate Work Items)

- **`first_message_sent` backend logic**: Requires new `has_sent_message` boolean field on user DB schema + migration + service logic. Tracked separately per spec Section 4.3. Frontend `message_sent` event (Task 8) provides the raw data; backend deduplication is the separate piece.
- **`subscription_changed` backend event**: BillingHubService proxies all subscription operations to an external BillingHub API. There are no direct subscription create/update/cancel methods in the gateway. This event should be triggered by a webhook from the billing platform, which is a separate integration task.

---

### Task 11: Final verification

- [ ] **Step 1: Run full client typecheck**

Run: `cd apps/client && pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run full client tests**

Run: `cd apps/client && pnpm test`
Expected: All pass

- [ ] **Step 3: Run full server build**

Run: `cd apps/server && pnpm build`
Expected: No errors

- [ ] **Step 4: Run server tests**

Run: `cd apps/server && pnpm jest --testPathPattern=workspace`
Expected: All pass
