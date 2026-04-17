import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import i18n from "@/i18n";
import api from "@/services/api";
import { useCurrentUser } from "./useAuth";

/**
 * Returns the browser's current BCP 47 language tag. Prefers the value the
 * user has explicitly selected through i18next (which is what the UI shows
 * them), falling back to `navigator.language` and finally `"en"`. The
 * return is always a non-empty string so the caller does not have to
 * guard every call site.
 */
function detectBrowserLanguage(): string {
  // i18n.language is kept in sync with the UI; this is the authoritative
  // "what language the user is actually reading" value.
  const current =
    typeof i18n.language === "string" && i18n.language.length > 0
      ? i18n.language
      : null;
  if (current) return current;

  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en";
}

/**
 * Returns the browser's detected IANA time zone. Uses the standard
 * `Intl.DateTimeFormat` API; if the runtime cannot resolve a zone name
 * (e.g. exotic embedded browsers), returns `null` and the caller omits
 * the field rather than sending a bad value to the server.
 */
function detectBrowserTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : null;
  } catch {
    return null;
  }
}

/**
 * Sync the browser's detected locale (BCP 47 language tag) and time zone
 * (IANA zone name) up to the team9 gateway on authenticated bootstrap,
 * but only when the currently persisted values differ from what the
 * browser reports. The sync runs at most once per mounted component
 * instance regardless of re-renders.
 *
 * This is what makes `team9:bootstrap.start` events carry the right
 * `team9Context.language` and `team9Context.timeZone` — the gateway reads
 * the persisted values when composing the payload, so the client has to
 * push them first.
 *
 * Fire-and-forget: any PATCH failure is swallowed with a console warn
 * because missing locale should never block the user from using the app.
 * The next login attempt will retry.
 */
export function useSyncUserLocale(): void {
  const { data: user } = useCurrentUser();
  const mutation = useMutation({
    mutationFn: (payload: { language?: string; timeZone?: string }) =>
      api.im.users.updateMe(payload),
  });
  // Guard against React StrictMode double-invoke and subsequent re-renders:
  // we only want one PATCH per authenticated app session.
  const hasSyncedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (hasSyncedRef.current) return;

    const detectedLanguage = detectBrowserLanguage();
    const detectedTimeZone = detectBrowserTimeZone();

    const payload: { language?: string; timeZone?: string } = {};
    if (detectedLanguage && detectedLanguage !== (user.language ?? null)) {
      payload.language = detectedLanguage;
    }
    if (detectedTimeZone && detectedTimeZone !== (user.timeZone ?? null)) {
      payload.timeZone = detectedTimeZone;
    }

    if (Object.keys(payload).length === 0) {
      // Nothing changed — still mark as synced so we do not re-check on
      // every render. A subsequent language switch in the settings UI
      // will trigger its own mutation via the settings screen, not this
      // hook.
      hasSyncedRef.current = true;
      return;
    }

    hasSyncedRef.current = true;
    mutation.mutate(payload, {
      onError: (error) => {
        // Non-fatal — allow the user to continue, let the next bootstrap
        // retry. Reset the guard so the NEXT useEffect pass can try
        // again (e.g. when the query refetches user data).
        hasSyncedRef.current = false;
        console.warn(
          "[useSyncUserLocale] Failed to sync browser locale/timeZone",
          error,
        );
      },
    });
    // We intentionally do NOT depend on `mutation` — the mutation object
    // identity changes on every render but its `.mutate` is stable. The
    // effect should re-run only when user data transitions (login / logout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.language, user?.timeZone]);
}
