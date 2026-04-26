# Routine Detail Page — Design

**Date:** 2026-04-26
**Status:** Draft → pending user review

## 1. Goal

Add a dedicated **detail page** for each Routine. Currently, clicking a Routine in the left sidebar auto-jumps to its first/active execution (ChatArea). Users have no place to see "what is this Routine, how is it triggered, what documents back it, what runs has it had" without opening the gear-icon Settings modal (which is partial).

The new detail page is the default landing target for a Routine click and consolidates Routine-level metadata, configuration, and history.

## 2. Scope

In scope:

- New routes for Routine detail (Overview / Triggers / Documents / Runs tabs).
- Replacement of `RoutineSettingsDialog` modal with a tabbed detail page.
- Left-sidebar simplification: routine cards expand to show only **active runs + creation sessions** (no historical runs).
- URL-driven selection: `/routines/$routineId` and `/routines/$routineId/runs/$executionId`.
- New `RunListItem` component with trigger / token / duration metadata for the detail page.

Out of scope:

- Backend changes (executions endpoint already returns full list; no pagination params added).
- Editing Routine title/description inline.
- Moving the Settings dialog content to anywhere other than the new detail page.
- Adding new fields to `Routine` / `RoutineExecution`.

## 3. URL & view modes

| URL                                                  | Layout                                         | Notes                          |
| ---------------------------------------------------- | ---------------------------------------------- | ------------------------------ |
| `/routines`                                          | Sidebar + center empty state                   | Existing empty state preserved |
| `/routines/$routineId`                               | Sidebar + `RoutineDetailView` (no right panel) | Default lands on Overview tab  |
| `/routines/$routineId?tab=triggers\|documents\|runs` | Same                                           | Tab selected from search param |
| `/routines/$routineId/runs/$executionId`             | Sidebar + ChatArea + RightPanel                | Existing 3-pane layout         |

**Draft routines:** Click → `/routines/$routineId/runs/creation` (sentinel route segment for creation session). Drafts never reach the detail page until completed.

**TanStack Router files:**

- `routes/_authenticated/routines/index.tsx` — existing, unchanged (renders sidebar + center empty state).
- `routes/_authenticated/routines/$routineId.tsx` — new, renders sidebar + `RoutineDetailView`.
- `routes/_authenticated/routines/$routineId.runs.$executionId.tsx` — new, renders sidebar + ChatArea + RightPanel.

The `executionId` value `creation` is treated as a sentinel by the run route — when it equals `creation`, the route renders the existing creation-session ChatArea (using `routine.creationChannelId`) instead of looking up an execution.

## 4. Sidebar (RoutinesSidebar)

The current `RoutineList.tsx` is split: the left column becomes a standalone `RoutinesSidebar` component used by all three routes. Center/right columns are owned by the route components.

**Selection state:** Sidebar reads `routineId` and `executionId` from URL params instead of internal state. No `useState` for `activeRoutineId` / `selectedRun`.

**Expansion state:** Sidebar still owns `expandedRoutineIds: Set<string>` for the chevron-driven toggle. The URL-selected routine is **auto-added** to the set when `routineId` changes (effect in `RoutinesSidebar`). The user can still collapse it via chevron, and other routines can be expanded independently. Result: the current routine starts expanded; user has full manual override.

**Routine card expansion (simplified):**

- When expanded, the card shows **only active runs** (`status ∈ {in_progress, paused, pending_action}`) + the `creation session` row if `status === draft`.
- Removed: `DEFAULT_VISIBLE_RUNS`, `showAllRuns` state, "Show more" button, full historical run list.
- If no active runs and not a draft, the expanded card body is empty (no "no runs yet" placeholder — collapses to header only).

**Click targets on a routine card:**

| Target                 | Behavior                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chevron arrow          | Toggle expand/collapse via `expandedRoutineIds`. **Does not navigate.**                                                                                         |
| Card body (title area) | Navigate to `/routines/$routineId` (or `/runs/creation` for draft). Navigation effect auto-expands this routine; does not directly mutate `expandedRoutineIds`. |
| Active run row         | Navigate to `/routines/$routineId/runs/$executionId`.                                                                                                           |
| ▶ Play button          | Open `ManualTriggerDialog` (unchanged).                                                                                                                         |
| ⚙️ Settings button     | Navigate to `/routines/$routineId?tab=overview` (no longer opens a modal).                                                                                      |

**Removed:**

- `showSettingsRoutineId` state.
- `settingsRoutineDetail` query.
- `RoutineSettingsDialog` rendering.

## 5. Detail page — RoutineDetailView

A new component that occupies the center pane on `/routines/$routineId`. The right panel is hidden on this route.

**Structure:**

```
┌──────────────────────────────────────────────────┐
│ <Routine title>  <status pill>           [⋯]    │  ← header, always visible
├──────────────────────────────────────────────────┤
│ [Overview] [Triggers] [Documents] [Runs]         │  ← shadcn Tabs
├──────────────────────────────────────────────────┤
│  <TabContent (scrollable)>                      │
└──────────────────────────────────────────────────┘
```

**Header:**

- Title (read-only, no inline edit).
- Status pill (reuse `STATUS_COLORS` mapping from `RoutineCard`).
- `[⋯]` overflow menu (top-right). Only entry: **Delete** → confirm dialog → `routinesApi.delete` → on success `navigate({ to: '/routines' })`. Delete entry is hidden when `!canDelete` (statuses other than `upcoming/completed/failed/stopped/timeout`).

**Tabs (shadcn `<Tabs>`):**

- Selected tab is bound to search param `?tab=overview|triggers|documents|runs`. Default `overview` when absent.
- Switching tabs updates search param via `navigate({ search: { tab: ... }, replace: true })`.

## 6. Overview tab

`RoutineOverviewTab.tsx`. Vertical sections:

1. **Description** — `routine.description`. Skip if empty.
2. **Metadata grid (2 columns):**
   - Created at — `formatMessageTime(routine.createdAt)`.
   - Last run at — `executions[0]?.startedAt` or `routine.currentExecution?.execution.startedAt` (whichever is most recent), formatted as relative time.
   - Total tokens — `routine.tokenUsage`. Hide if `null` or `0`.
   - Current execution status — if `routine.currentExecution` present: status pill + "View" link to `/routines/$routineId/runs/$executionId`.
3. **Bot assignment** — `<Select>` (reuse the block from current `RoutineSettingsTab.tsx:86-110`). On change, call `routinesApi.update(id, { botId })` and invalidate `["routine", id]` + `["routines"]`.
4. **Recent 5 runs:**
   - First 5 entries of `executions` (already sorted by `startedAt` desc).
   - Render each via `<RunListItem>` (see §8).
   - Click a row → `navigate({ to: '/routines/$routineId/runs/$executionId' })`.
   - Below the list: **"View all runs →"** link → `navigate({ search: { tab: 'runs' } })`.
   - Empty state ("No runs yet") if `executions.length === 0`.
   - Show fewer than 5 if fewer exist.

Delete button is **not** rendered in this tab — it lives in the header `[⋯]` menu.

## 7. Triggers / Documents tabs

Both tabs reuse existing components verbatim. Tab content is wrapped in a `<ScrollArea>` for long content.

- **Triggers tab:** `<RoutineTriggersTab routineId={routine.id} />` — existing 242-line component. No code changes inside.
- **Documents tab:** `<RoutineDocumentTab routine={routine} />` — existing 326-line component. No code changes inside.

Names are kept as-is (`RoutineTriggersTab` / `RoutineDocumentTab`) — renaming would touch imports and tests for negligible clarity gain.

## 8. Runs tab

`RoutineRunsTab.tsx`. Single vertical column of all executions, descending by `startedAt`.

**Progressive display (frontend batching):**

- Backend `GET /v1/routines/:id/executions` returns the full list (no `limit`/`offset` added).
- Default visible count: 20 entries. Below the list, **"Show 20 more"** button increments visible count by 20 each click. Hide button when all entries shown.
- React Query `refetchInterval: 5000` while the Runs tab is the active tab; pause when another tab is active (use `enabled: tab === "runs"` for the query, or pass `refetchInterval` conditionally).

**Each row uses `RunListItem`:**

```
┌──────────────────────────────────────────────┐
│ ● <status>  v3   2h ago         [Manual]    │
│   1.2k tokens · 3m 24s                       │
└──────────────────────────────────────────────┘
```

**Trigger badge mapping:**

| Condition                                   | Badge       |
| ------------------------------------------- | ----------- |
| `triggerContext.originalExecutionId` truthy | `Retry`     |
| `triggerType === "manual"`                  | `Manual`    |
| `triggerType === "schedule"`                | `Scheduled` |
| `triggerType === "interval"`                | `Interval`  |
| `triggerType === "channel_message"`         | `Channel`   |
| else                                        | (no badge)  |

**Duration:**

- Finished runs (`finishedAt` set): `format(finishedAt - startedAt)` — e.g. `3m 24s`, `1h 12m`, `0s` if same instant.
- In-progress runs: `running 3m+` (uses live `Date.now() - startedAt`, recomputed each render — no timer needed since query refetches every 5s).
- Missing `startedAt`: hide duration.

**Token display:**

- Show `<formatNumber> tokens` when `execution.tokenUsage > 0`.
- Hide when `null` / `0`.

**Selected state:** Highlight the row whose `id === executionId` URL param. Click → navigate.

## 9. RunListItem

New component, separate from existing `RunItem` (which keeps the compact sidebar variant unchanged).

```ts
interface RunListItemProps {
  execution: RoutineExecution;
  isSelected: boolean;
  onClick: () => void;
}
```

Used by:

- `RoutineOverviewTab` (recent 5 list).
- `RoutineRunsTab` (full list).

## 10. Files

**New:**

- `apps/client/src/routes/_authenticated/routines/$routineId.tsx`
- `apps/client/src/routes/_authenticated/routines/$routineId.runs.$executionId.tsx`
- `apps/client/src/components/routines/RoutinesSidebar.tsx`
- `apps/client/src/components/routines/RoutineDetailView.tsx`
- `apps/client/src/components/routines/RunListItem.tsx`
- `apps/client/src/components/routines/tabs/RoutineOverviewTab.tsx`
- `apps/client/src/components/routines/tabs/RoutineRunsTab.tsx`

**Modified:**

- `apps/client/src/routes/_authenticated/routines/index.tsx` — render new `RoutinesSidebar` + center empty state.
- `apps/client/src/components/routines/RoutineCard.tsx` — simplify expansion logic (active runs only), split chevron vs. body click handlers, drop `showAllRuns` and `DEFAULT_VISIBLE_RUNS`.

**Deleted:**

- `apps/client/src/components/routines/RoutineList.tsx` — superseded by per-route components + `RoutinesSidebar`.
- `apps/client/src/components/routines/RoutineSettingsDialog.tsx`
- `apps/client/src/components/routines/RoutineSettingsTab.tsx` — its Bot-assignment + delete logic migrates to Overview tab + header menu.

Verify before deleting `RoutineSettingsDialog` / `RoutineSettingsTab`: grep the repo to confirm only `RoutineList.tsx` references them.

## 11. Testing

Per repo convention (100% coverage, see `CLAUDE.md`):

| File                                     | Coverage                                                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RoutineOverviewTab.test.tsx`            | description rendering, metadata grid (with/without currentExecution, token=0 hidden), bot assignment Select change calls update mutation, "View" link navigates, recent-5 list (5 / fewer / 0 empty state), View-all-runs link switches tab |
| `RoutineRunsTab.test.tsx`                | list renders all executions sorted, Show-more button (20 → 40 → 60), button hides when all shown, click navigates, polling enabled when active / disabled otherwise, empty state                                                            |
| `RunListItem.test.tsx`                   | trigger badge mapping (manual/schedule/interval/channel_message/retry/null/unknown), duration format (finished/running/missing startedAt), token display (>0 shown / 0 hidden), selected state styling                                      |
| `RoutineDetailView.test.tsx`             | tab switch updates search param, deep link `?tab=runs` activates Runs tab on mount, header [⋯] menu shows Delete only when canDelete, Delete confirm flow + navigate to /routines on success                                                |
| `RoutineCard.test.tsx` (update existing) | chevron click toggles `expandedRoutineIds` only (no navigate), body click navigates without directly mutating expansion set, expanded body shows only active runs + creation row, draft body click navigates to `/runs/creation`            |
| `RoutinesSidebar.test.tsx`               | reads selection from URL, URL `routineId` change auto-adds to `expandedRoutineIds`, user collapse via chevron persists across re-renders, list filters / tabs work as before                                                                |

**Bad-case coverage:**

- Detail page route with invalid / forbidden `routineId` → error fallback + link back to `/routines`.
- Run route with non-existent `executionId` (and not the `creation` sentinel) → error fallback + link back to detail page.
- Loading skeleton during initial query.
- Network error display.

**Existing tests to update:**

- Anything in `__tests__/` that imports `RoutineList` / `RoutineSettingsDialog`.

## 12. Migration & rollout

- Pure frontend refactor; no backend or schema change.
- i18n keys preserved as-is (`detail.*`, `settingsTab.*`, `triggers.*`, `documents.*`); no key renames.
- Breaking change: anyone bookmarking the (formerly nonexistent) Routines URL is unaffected; new URLs are additive.
- Single PR, no feature flag — surface area is contained.

## 13. Open considerations / non-decisions

- "Recent 5 runs" count is fixed at 5; no user-facing setting.
- "Show 20 more" batch size is fixed at 20.
- Backend pagination is deferred until real performance pain shows up.
- Duration format uses simple `Xm Ys` / `Xh Ym` style; no localization beyond reusing existing date helpers.
