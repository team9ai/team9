# Task Document Editor Design

**Date:** 2026-03-10
**Status:** Approved

## Overview

Upgrade the Task Detail Panel's Document tab from a read-only markdown preview to a full WYSIWYG document editor with version management and AI suggestion review.

## Decisions

- **Editor:** Lexical WYSIWYG (rich text), reusing existing Lexical infrastructure
- **Approach:** Hybrid — inline editor in the 400px panel for editing, modal dialog for suggestion diff view
- **Save mode:** Manual save with localStorage draft persistence
- **Version switching:** Dropdown selector, historical versions are read-only
- **AI suggestions:** Collapsible list in panel, diff comparison in modal

## Layout

Within the 400px TaskDetailPanel, the Document tab renders top-to-bottom:

```
┌─────────────────────────────────┐
│ [Version 3 (current) ▾] [Save] │  ← Version selector + save button
├─────────────────────────────────┤
│ [B] [I] [•] [1.] [<>] [❝]     │  ← Compact formatting toolbar
├─────────────────────────────────┤
│                                 │
│   Lexical WYSIWYG Editor        │  ← Main editor, flex-1
│                                 │
├─────────────────────────────────┤
│ AI Suggestions (2)          [▾] │  ← Collapsible (only if pending)
│ ┌─ Suggestion #1 ──── [View] ┐ │
│ └────────────────────────────┘ │
└─────────────────────────────────┘
```

## DocumentEditor Component

New `DocumentEditor` component, distinct from the existing `RichTextEditor` (message editor):

| Feature       | MessageInput        | DocumentEditor      |
| ------------- | ------------------- | ------------------- |
| Toolbar       | B/I/List/Emoji/File | B/I/List/Code/Quote |
| Enter         | Send message        | New line            |
| Import/Export | HTML                | Markdown            |
| Mention       | Yes                 | No                  |
| Height        | compact/fixed       | flex-1 fill         |

**Markdown conversion:** Uses `@lexical/markdown` — `$convertFromMarkdownString` to load, `$convertToMarkdownString` to save.

**Draft mechanism:** Content stored in `localStorage` key `doc-draft-{documentId}`. "Unsaved changes" indicator shown when draft differs from saved version. Confirmation dialog on close/version-switch if unsaved.

## Version Switching

- **Dropdown:** Radix UI Select — `Version 3 (current)` / `Version 2 — 03/09 23:03` / etc.
- **Data:** `documentsApi.getVersions(documentId)`
- **Historical version:** Editor becomes read-only, `bg-muted/30` background, yellow banner: "Viewing version X · [Back to current]"
- **Switch with unsaved changes:** Confirmation dialog "You have unsaved changes. Discard?"

## Save Flow

1. Click Save → inline summary input expands (optional)
2. Call `documentsApi.update(id, { content, summary })`
3. Clear localStorage draft
4. Invalidate document + versions queries
5. Dropdown updates with new current version

## AI Suggestions

**In-panel list:**

- Only renders when pending suggestions exist
- Collapsible section: "AI Suggestions (N)"
- Each suggestion: summary text + `View` button

**Diff modal (on View click):**

- Modal width: `max-w-3xl` (~768px)
- Title: suggestion summary
- Content: two-column diff — "Current" vs "Suggested" (both markdown)
- Diff highlighting via `diff` npm package (already in project)
- Actions: `Reject` / `Approve` buttons
- Approve → `reviewSuggestion(docId, sugId, 'approve')` → invalidates document/versions/suggestions → editor loads new version
- Reject → `reviewSuggestion(docId, sugId, 'reject')` → removes from list

## Edge Cases

- **No documentId:** Empty editor + "Start writing to create a document" placeholder. First Save creates document and associates with task.
- **Empty content:** Normal empty editor, no "No content" text.
- **Concurrent edits:** No special handling. Save conflict → error toast → prompt refresh.
- **Loading:** Editor area shows skeleton, version dropdown disabled.

## Components

**New:**
| Component | Path |
|-----------|------|
| `DocumentEditor` | `components/documents/DocumentEditor.tsx` |
| `DocumentToolbar` | `components/documents/DocumentToolbar.tsx` |
| `SuggestionsList` | `components/documents/SuggestionsList.tsx` |
| `SuggestionDiffModal` | `components/documents/SuggestionDiffModal.tsx` |

**Modified:**

- `TaskDocumentTab` — rewritten to compose above components

**Removed:**

- `DocumentVersionHistory` — replaced by version dropdown
- ReactMarkdown preview logic in `TaskDocumentTab`
