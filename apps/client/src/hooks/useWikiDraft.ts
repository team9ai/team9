import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "./useAuth";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

/**
 * A draft payload persisted to `localStorage` while the user edits a Wiki
 * page. `savedAt` is an epoch-ms timestamp so we can compare against the
 * server's `lastCommit.timestamp` to decide whether the draft predates the
 * latest commit (discard silently) or was captured after it (show a
 * stale-alert so the user doesn't silently lose work).
 */
export interface Draft {
  body: string;
  frontmatter: Record<string, unknown>;
  savedAt: number;
}

/**
 * Server snapshot shape `useWikiDraft` expects from its caller — a subset of
 * `PageDto` normalised to the fields we need for stale detection. Callers
 * can pass `null` before the server fetch resolves; the hook will no-op.
 */
export interface WikiDraftServerSnapshot {
  body: string;
  frontmatter: Record<string, unknown>;
  lastCommitTime: string | null;
}

/**
 * Build the localStorage key. The four-axis namespace (workspace × wiki ×
 * path × user) guarantees two users editing the same page on the same
 * machine never clobber each other, and switching workspaces/wikis/pages
 * never mixes up drafts. Base64 is used on the path so slashes and other
 * URL-unsafe characters don't collide with our `.`-delimited format.
 */
export function buildDraftKey(
  userId: string,
  workspaceId: string,
  wikiId: string,
  path: string,
): string {
  // UTF-8 safe base64 — `unescape(encodeURIComponent(x))` produces a binary
  // string btoa can safely consume for non-ASCII paths.
  const pathB64 = btoa(unescape(encodeURIComponent(path)));
  return `team9.wiki.draft.${workspaceId}.${wikiId}.${pathB64}.${userId}`;
}

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Draft).body !== "string" ||
      typeof (parsed as Draft).savedAt !== "number" ||
      typeof (parsed as Draft).frontmatter !== "object" ||
      (parsed as Draft).frontmatter === null
    ) {
      return null;
    }
    return parsed as Draft;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // quota exceeded, SSR, or storage unavailable — silently drop so the UI
    // stays responsive. The in-memory draft still works for the session.
  }
}

/**
 * Draft-persistence hook for the Wiki page editor.
 *
 * Contract:
 *  - Returns `null` draft until something is set (or a valid one is loaded
 *    from storage). `isDirty` is `draft != null` so a pristine view is
 *    never "dirty".
 *  - Debounces writes to localStorage by 500ms to avoid hammering storage
 *    on every keystroke. In-memory state updates synchronously so the UI
 *    stays snappy.
 *  - On mount (and whenever the key or server snapshot changes) reconciles
 *    against the server's `lastCommitTime`:
 *      • No draft → nothing to do.
 *      • Draft newer than server → keep draft, raise `hasStaleAlert` so UI
 *        can offer a "discard" / "keep" decision (Task 19 wiring).
 *      • Draft older/equal → silently remove, since the server has a newer
 *        truth we'd otherwise shadow.
 *  - `clearDraft` cancels pending debounces before removing storage so a
 *    stale write can't resurrect a cleared draft.
 */
export function useWikiDraft(
  wikiId: string | null,
  path: string | null,
  serverSnapshot: WikiDraftServerSnapshot | null,
) {
  const currentUserQuery = useCurrentUser();
  const currentUser = currentUserQuery?.data ?? null;
  const workspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);

  const [draft, setDraftState] = useState<Draft | null>(null);
  const [hasStaleAlert, setHasStaleAlert] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key =
    currentUser && workspaceId && wikiId && path
      ? buildDraftKey(currentUser.id, workspaceId, wikiId, path)
      : null;

  // Depend on the *value* we care about (the commit timestamp), not the
  // snapshot object's reference. Callers often pass a fresh literal every
  // render (e.g. `useWikiPage(...).data` is stable, but tests and ad-hoc
  // callers may not be) — keying on the reference would cause the effect
  // to fire every render and re-set state, producing an infinite render
  // loop. We also need to know whether we've seen *any* snapshot at all,
  // so we coalesce null / string into a single comparable scalar.
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
      const d: Draft = { ...next, savedAt: Date.now() };
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
