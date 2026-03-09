import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function useDeepLink() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!IS_TAURI) return;

    let unlisten: (() => void) | undefined;

    async function setup() {
      const { onOpenUrl, getCurrent } =
        await import("@tauri-apps/plugin-deep-link");

      // Handle deep link that launched the app (cold start)
      const urls = await getCurrent();
      if (urls && urls.length > 0) {
        handleDeepLinkUrl(urls[0]);
      }

      // Handle deep link while app is running (warm start)
      unlisten = await onOpenUrl((urls) => {
        if (urls.length > 0) {
          handleDeepLinkUrl(urls[0]);
        }
      });
    }

    function handleDeepLinkUrl(url: string) {
      try {
        // Parse team9://auth-complete or team9://auth-complete?sessionId=XXX
        const parsed = new URL(url);
        const path =
          parsed.hostname === "auth-complete"
            ? "auth-complete"
            : parsed.pathname.replace(/^\/+/, "");

        if (path === "auth-complete") {
          const sessionId = parsed.searchParams.get("sessionId");
          if (sessionId) {
            sessionStorage.setItem("deep_link_session_id", sessionId);
          }
          // Navigate to login page which will pick up the polling session
          navigate({ to: "/login" });
        }
      } catch {
        // Invalid URL, ignore
      }
    }

    setup();

    return () => unlisten?.();
  }, [navigate]);
}
