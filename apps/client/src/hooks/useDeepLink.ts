import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import api from "@/services/api";
import { setAuthTokens, getAuthToken } from "@/services/auth-session";
import { syncCurrentUser } from "@/hooks/useAuth";

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

    async function handleDeepLinkUrl(url: string) {
      try {
        const parsed = new URL(url);
        const path =
          parsed.hostname === "auth-complete"
            ? "auth-complete"
            : parsed.pathname.replace(/^\/+/, "");

        if (path !== "auth-complete") return;

        // Already logged in — do nothing
        if (getAuthToken()) return;

        const sessionId = parsed.searchParams.get("sessionId");
        if (!sessionId) return;

        // Store for recovery if the immediate poll fails
        localStorage.setItem("pending_desktop_session_id", sessionId);

        // Immediately try to exchange sessionId for tokens
        try {
          const result = await api.auth.pollLogin(sessionId);
          if (
            result.status === "verified" &&
            result.accessToken &&
            result.refreshToken &&
            result.user
          ) {
            setAuthTokens({
              accessToken: result.accessToken,
              refreshToken: result.refreshToken,
            });
            syncCurrentUser(result.user);
            localStorage.removeItem("pending_desktop_session_id");
            navigate({ to: "/" });
            return;
          }
        } catch {
          // Poll failed or session not ready yet
        }

        // Not verified yet — fall back to login page where polling continues
        navigate({ to: "/login" });
      } catch {
        // Invalid URL, ignore
      }
    }

    setup();

    return () => unlisten?.();
  }, [navigate]);
}
