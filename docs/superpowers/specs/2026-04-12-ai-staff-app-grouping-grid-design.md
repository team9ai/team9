# AI Staff Page: App Grouping + Grid Layout

**Date:** 2026-04-12
**Status:** Approved
**Scope:** Frontend only — `AIStaffMainContent.tsx`

## Problem

1. The "AI 员工" section displays all bots in a flat list with no sub-grouping by application
2. Cards are constrained to `max-w-md` (single column), wasting horizontal space

## Design

### Layout Changes

- Replace `max-w-md` with `max-w-5xl` to utilize available width
- Replace `space-y-2` vertical stacking with responsive CSS Grid:
  `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3`
- Apply grid layout to all sections: My Personal Staff, AI Staff sub-groups, and Members
- Card component (`AIStaffBotCard`, `MemberCard`) retains existing horizontal layout (avatar + info + chat button)

### AI Staff Sub-Grouping by App

- Change `aiStaffBots` from a flat array to a grouped structure: `Array<{ app, bots[] }>`
  grouped by `app.id`
- The "AI 员工" top-level section header remains, showing total bot count across all apps
- Under it, each App renders as a collapsible sub-group:
  - Sub-header: `app.name` + bot count badge, with chevron toggle
  - Sub-group content: responsive grid of bot cards
  - Default state: all sub-groups expanded

### State Management

- Existing `aiStaffExpanded` controls the entire AI Staff section (unchanged)
- New `appGroupExpanded: Record<string, boolean>` state for per-app sub-group toggle
  - Default: all expanded (missing key = expanded)
- Collapsing the top-level AI Staff section hides everything; expanding restores per-app states

### Sub-Header Styling

- Slightly indented from the top-level section header (e.g. `pl-4`)
- Smaller font weight or size to visually distinguish from top-level headers
- Same chevron + badge pattern as `SectionHeader`, reuse the component with a `level` or `sub` prop

## Files Modified

- `apps/client/src/components/layout/contents/AIStaffMainContent.tsx`

## Out of Scope

- Backend API changes (grouping is purely frontend)
- Card component redesign (keeping existing horizontal layout)
- New i18n keys (app names come from API data)
