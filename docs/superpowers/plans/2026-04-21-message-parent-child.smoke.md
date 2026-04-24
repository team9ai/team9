# Smoke Checklist — Message Parent-Child Relations

Run `pnpm dev` locally (server + client both up) and walk through these manually.

## Setup

- [ ] Create a fresh channel; ensure it's a `public` type (not `task` / `routine-session`).
- [ ] Have at least 2 distinct users in the channel for multi-client WS tests.

## Property-menu shortcuts (Task 12)

- [ ] Open the channel's property panel; "添加属性" menu shows the "任务关系" group with entries **父任务** and **关联任务**.
- [ ] Click "父任务" → a new property `parentMessage` appears with `valueType: message_ref`, `config: { scope: 'same_channel', cardinality: 'single', relationKind: 'parent' }`.
- [ ] Click "父任务" again → the entry is disabled with tooltip "此频道已有父任务属性". If you force-click, no new property is created.
- [ ] Click "关联任务" → a new property `relatedMessages` with `cardinality: 'multi'`, `relationKind: 'related'` appears.
- [ ] Clicking "关联任务" again creates a second related-kind definition auto-suffixed `relatedMessages-2`.

## Message-ref editor scope (Task 11)

- [ ] Set `parentMessage` on a message M1. The picker only searches messages in the CURRENT channel (verified by monitoring network tab: request includes `channelId` filter).
- [ ] The current message M1 does not appear in its own picker results.
- [ ] Single-cardinality: selecting a target replaces the old value and closes the dropdown.
- [ ] Multi-cardinality (`relatedMessages`): selecting appends and keeps the dropdown open.

## Thread-derived parent (spec §4.1)

- [ ] Create a thread reply R under thread root T in the channel.
- [ ] On R, set any property value (e.g., a text property) so R "becomes a task".
- [ ] Inspect R's parent: `GET /im/messages/R/properties/relations` returns `outgoing.parent` with `parentSource: 'thread'`.
- [ ] In R's chat bubble, the relation chip bar shows `↑ 父: [T chip]` with a 🧵 badge on the chip.

## Explicit override (spec §4.2)

- [ ] On R, set `parentMessage` property to some OTHER message O (not T).
- [ ] `GET /im/messages/R/properties/relations` now returns `outgoing.parent` with target `O`, `parentSource: 'relation'`.
- [ ] The chat-bubble chip bar shows O without the 🧵 badge. The thread relationship with T remains intact (R is still a thread reply of T).

## Explicit clear (spec §4.3)

- [ ] Clear R's `parentMessage` (e.g., via the picker's clear button or sending null).
- [ ] `GET /im/messages/R/properties/relations` returns `outgoing.parent: []`.
- [ ] R's chat chip bar no longer shows a parent chip (despite R still being a thread reply).

## Cycle rejection (Task 4)

- [ ] Create A, B, C in the channel. Set B.parentMessage = A. Then C.parentMessage = B.
- [ ] Attempt to set A.parentMessage = C. Expect API error with `code: "RELATION_CYCLE_DETECTED"` and a toast in the UI.
- [ ] Attempt to set A.parentMessage = A. Expect `code: "RELATION_SELF_REFERENCE"`.

## Depth limit (spec §3.4)

- [ ] Build a chain A1 → A2 → … → A10 (each Ai has parentMessage = A(i-1)).
- [ ] Attempt to set A11.parentMessage = A10. Expect `code: "RELATION_DEPTH_EXCEEDED"`.

## Scope violation

- [ ] With `scope: 'same_channel'`, attempt to set `parentMessage` of M in channel 1 to a message in channel 2 (craft request via curl or devtools).
- [ ] Expect `code: "RELATION_SCOPE_VIOLATION"`.

## Table hierarchy mode (Tasks 15 + 16)

- [ ] In the table view, toggle "层级视图" in the toolbar. The `groupBy` control becomes disabled.
- [ ] With `hierarchyDefaultDepth` = 3, messages render indented by depth. Root messages at depth 0 have no indent.
- [ ] Children of a node show an ▸ arrow. Clicking expands (▸ → ▾) and shows their children.
- [ ] Clicking ▾ collapses; children are removed from DOM (verified via devtools → no CSS-hidden rows).
- [ ] Keyboard: focus a row with `Tab`, press → to expand, ← to collapse.
- [ ] Add a filter that matches only a deeply nested message G. The table shows G plus its ancestor chain dimmed (gray bg + left border). Siblings of ancestors are NOT shown.

## Deleted reference (spec §4.3)

- [ ] Set B.parentMessage = A.
- [ ] Soft-delete A.
- [ ] B's relation bar still shows a chip pointing at A, rendered as `[已删除]` with strike-through; clicking is disabled.
- [ ] Table hierarchy shows a row for A as "[已删除]" but B remains under it.

## Forbidden reference

- [ ] As user U1, set B.parentMessage = A.
- [ ] As user U2 (not a member of the channel — hypothetical, or simulated via missing permission): the relation chip renders `[无权限]` without navigation.

## Relation-kind WS sync (Task 9)

- [ ] Open the channel in two separate browser windows, both signed in.
- [ ] In window 1, set R.parentMessage = T.
- [ ] In window 2, within ~1 second, the chat-bubble chip bar for R updates to show T as parent. No manual refresh needed.
- [ ] In window 1, delete a message that is a target of some `relatedMessages` chip.
- [ ] In window 2, the corresponding chip in the other chat bubble updates to `[已删除]` within ~1 second.

## Known limitations (not blockers for this PR)

- Hierarchy-mode table rows render property cells as `"-"` placeholders (only primary cell shows message snippet). Full property hydration per node is deferred.
- `findMessageIdsForView` ignores the view's filter/sort DSL; currently returns all non-deleted channel messages by `createdAt desc`. Wiring the full DSL is deferred.
- No UI lock on `groupBy` panel when hierarchy mode is active; the backend rejects the combination but the UI doesn't proactively disable the groupBy picker.
- Race condition on parent-uniqueness check (two concurrent creates could both pass the SELECT). Add a partial unique index in a follow-up migration.

## Regression

- [ ] Legacy `message_ref` properties (created manually with no `relationKind` in config) continue to work: value persists as `jsonValue` array, no relation table entries, no chip bar.
- [ ] Existing thread functionality unchanged: thread replies still render in threads, no regression in unread counts.
- [ ] All existing Jest + Vitest suites pass.
