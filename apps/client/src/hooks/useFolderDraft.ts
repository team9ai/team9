import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A draft payload persisted to `localStorage` while the user edits a file
 * inside a `<Folder9FolderEditor>` shell. `savedAt` is an epoch-ms timestamp
 * so we can compare against the server's `lastCommitTime` to decide whether
 * the draft predates the latest commit (discard silently) or was captured
 * after it (show a stale-alert so the user doesn't silently lose work).
 *
 * `frontmatter` is kept on the draft so callers that edit YAML-frontmatter
 * markdown (e.g. wikis) can persist their structured state alongside the
 * body without forcing other callers (e.g. routine SKILL.md, plain text
 * files) to populate it — they can simply pass `{}`.
 */
export interface FolderDraft {
  body: string;
  frontmatter: Record<string, unknown>;
  savedAt: number;
}

/**
 * Server snapshot shape `useFolderDraft` expects from its caller. Callers
 * can pass `null` before the server fetch resolves; the hook will no-op
 * (no draft load, no stale-alert) until the snapshot arrives.
 */
export interface FolderDraftServerSnapshot {
  body: string;
  frontmatter: Record<string, unknown>;
  /**
   * RFC3339 / ISO8601 timestamp of the last commit that authored the
   * server's current copy. `null` is treated as epoch 0 (a server-side
   * "we have no history" sentinel) so any extant draft wins and is
   * surfaced via the stale-alert.
   */
  lastCommitTime: string | null;
}

/**
 * Build the localStorage key for a draft.
 *
 * `draftKey` is fully caller-controlled — the shell-side hook stays
 * source-agnostic, and callers compose the namespace however they need
 * (e.g. `${workspaceId}.${wikiId}.${userId}` for wikis,
 * `${workspaceId}.${routineId}.${userId}` for routine skill folders).
 *
 * The path is base64-encoded so slashes and other URL-unsafe characters
 * don't collide with the `.`-delimited format. Multi-byte unicode is
 * funnelled through `TextEncoder` first because raw `btoa` would throw
 * on non-Latin1 input.
 */
export function buildFolderDraftKey(draftKey: string, path: string): string {
  // UTF-8 safe base64 via TextEncoder. Produces identical output for ASCII
  // paths; correct bytes for multi-byte chars.
  const pathB64 = btoa(String.fromCharCode(...new TextEncoder().encode(path)));
  return `team9.folder.draft.${draftKey}.${pathB64}`;
}

function readDraft(key: string): FolderDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as FolderDraft).body !== "string" ||
      typeof (parsed as FolderDraft).savedAt !== "number" ||
      typeof (parsed as FolderDraft).frontmatter !== "object" ||
      (parsed as FolderDraft).frontmatter === null
    ) {
      return null;
    }
    return parsed as FolderDraft;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: FolderDraft): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // quota exceeded, SSR, or storage unavailable — silently drop so the UI
    // stays responsive. The in-memory draft still works for the session.
  }
}

/**
 * Draft-persistence hook for the generic folder editor shell.
 *
 * Contract mirrors `useWikiDraft` semantics so existing wiki editor
 * behaviour can migrate onto the shell without changing observable
 * behaviour:
 *  - Returns `null` draft until something is set (or a valid one is
 *    loaded from storage). `isDirty` is `draft != null` so a pristine
 *    view is never "dirty".
 *  - Debounces writes to localStorage by 500ms to avoid hammering
 *    storage on every keystroke. In-memory state updates synchronously
 *    so the UI stays snappy.
 *  - On mount (and whenever the key or server snapshot changes)
 *    reconciles against the server's `lastCommitTime`:
 *      • No draft → nothing to do.
 *      • Draft newer than server → keep draft, raise `hasStaleAlert`
 *        so the UI can offer a "discard" / "keep" decision.
 *      • Draft older/equal → silently remove, since the server has a
 *        newer truth we'd otherwise shadow.
 *  - `clearDraft` cancels pending debounces before removing storage so
 *    a stale write can't resurrect a cleared draft.
 *
 * `draftKey` and `path` are both nullable so callers can mount the
 * hook before either value is known (e.g. before the parent's data
 * fetch resolves) without resorting to conditional hook calls. The
 * hook no-ops in that state.
 */
export function useFolderDraft(
  draftKey: string | null,
  path: string | null,
  serverSnapshot: FolderDraftServerSnapshot | null,
) {
  const [draft, setDraftState] = useState<FolderDraft | null>(null);
  const [hasStaleAlert, setHasStaleAlert] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = draftKey && path ? buildFolderDraftKey(draftKey, path) : null;

  // Depend on the *value* we care about (the commit timestamp), not the
  // snapshot object's reference. Callers often pass a fresh literal every
  // render — keying on the reference would cause the effect to fire every
  // render and re-set state, producing an infinite render loop. We also
  // need to know whether we've seen *any* snapshot at all, so we coalesce
  // null / string into a single comparable scalar.
  const snapshotSignal =
    serverSnapshot == null ? null : (serverSnapshot.lastCommitTime ?? "");

  // Load existing draft (if any) and reconcile with the server snapshot
  // whenever the key or the commit signal changes. A fresh server refetch
  // that advances `lastCommitTime` re-triggers the stale-check, so another
  // user's commit while we're on the page doesn't silently shadow truth.
  useEffect(() => {
    if (!key || snapshotSignal === null) {
      setDraftState(null);
      setHasStaleAlert(false);
      return;
    }
    const existing = readDraft(key);
    if (!existing) {
      setDraftState(null);
      setHasStaleAlert(false);
      return;
    }
    const serverTime =
      snapshotSignal === "" ? 0 : new Date(snapshotSignal).getTime();
    if (existing.savedAt > serverTime) {
      setDraftState(existing);
      setHasStaleAlert(true);
    } else {
      // Server snapshot is newer than (or equal to) draft → discard draft
      // silently. A stale draft would otherwise shadow the freshly-committed
      // content and confuse the user.
      try {
        localStorage.removeItem(key);
      } catch {
        // Browser refused storage access (Safari private mode, extensions) —
        // tolerate; local state is still cleared below.
      }
      setDraftState(null);
      setHasStaleAlert(false);
    }
  }, [key, snapshotSignal]);

  // Cancel any pending debounce when the component unmounts. Otherwise a
  // rapid-unmount could schedule a write against a key we've since torn
  // down, producing a ghost draft.
  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    },
    [],
  );

  const setDraft = useCallback(
    (next: { body: string; frontmatter: Record<string, unknown> }) => {
      if (!key) return;
      const d: FolderDraft = { ...next, savedAt: Date.now() };
      setDraftState(d);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        writeDraft(key, d);
        debounceRef.current = null;
      }, 500);
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    setDraftState(null);
    setHasStaleAlert(false);
  }, [key]);

  const dismissStaleAlert = useCallback(() => setHasStaleAlert(false), []);

  const isDirty = draft != null;

  return {
    draft,
    setDraft,
    clearDraft,
    isDirty,
    hasStaleAlert,
    dismissStaleAlert,
  };
}
