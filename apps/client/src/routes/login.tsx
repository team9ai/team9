import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  useAuthStart,
  useVerifyCode,
  useGoogleAuth,
  useCurrentUser,
  useLoginPolling,
  useCreateDesktopSession,
  useCompleteDesktopSession,
} from "@/hooks/useAuth";
import { useInvitationInfo } from "@/hooks/useWorkspace";
import { GoogleLogin } from "@react-oauth/google";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/services/http";
import { Mail, Loader2, Monitor, Users, ArrowLeft } from "lucide-react";
import { useTeam9PostHog } from "@/analytics/posthog/provider";
import { captureWithBridge } from "@/analytics/posthog/capture";
import { EVENTS } from "@/analytics/posthog/events";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const TURNSTILE_SITE_KEY = import.meta.env
  .VITE_CLOUDFLARE_TURNSTILE_SITE_KEY as string | undefined;

// Map app i18n language to Turnstile's supported language tags.
// Turnstile accepts: ar-eg, de, en, es, fa, fr, id, it, ja, ko, nl, pl,
// pt-br, ru, tr, uk, zh-cn, zh-tw (see Cloudflare Turnstile docs).
function toTurnstileLanguage(lng: string): string {
  const lower = lng.toLowerCase();
  if (lower.startsWith("zh-hans")) return "zh-cn";
  if (lower.startsWith("zh-hant")) return "zh-tw";
  if (lower === "zh-cn" || lower === "zh-tw") return lower;
  if (lower.startsWith("pt")) return "pt-br";
  return lower.split("-")[0];
}

const MAIL_QUICK_LINKS = [
  { name: "Gmail", url: "https://mail.google.com" },
  { name: "Outlook", url: "https://outlook.live.com" },
];

type LoginSearch = {
  redirect?: string;
  invite?: string;
  desktopSessionId?: string;
};

// ─── Shared Layout ──────────────────────────────────────────────────────────

function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background: [
          "radial-gradient(ellipse 80% 60% at 50% -20%, oklch(from var(--primary) l c h / 12%), transparent)",
          "radial-gradient(ellipse 60% 50% at 80% 80%, oklch(from var(--accent) l c h / 8%), transparent)",
          "radial-gradient(ellipse 50% 40% at 10% 60%, oklch(from var(--primary) l c h / 6%), transparent)",
          "var(--background)",
        ].join(", "),
      }}
    >
      <div className="w-full max-w-105 px-5">{children}</div>
    </div>
  );
}

function LogoBanner({ subtitle }: { subtitle?: string }) {
  const { t } = useTranslation("auth");
  return (
    <div className="flex flex-col items-center pt-2 pb-6 border-b border-border/40 mb-6">
      <img
        src="/team9-logo.png"
        alt={t("logoAlt")}
        className="w-52 max-w-full h-auto mb-2 transition-transform duration-300 hover:scale-[1.02]"
        style={{
          filter:
            "drop-shadow(0 4px 12px oklch(from var(--primary) l c h / 20%))",
        }}
      />
      <h1 className="sr-only">Team9</h1>
      {subtitle && (
        <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
      )}
    </div>
  );
}

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl p-8 ${className}`}
      style={{
        background: "oklch(from var(--background) l c h / 80%)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        border: "1px solid oklch(from var(--border) l c h / 60%)",
        boxShadow: [
          "0 0 0 1px oklch(from var(--background) l c h / 40%)",
          "0 4px 6px -1px oklch(from var(--foreground) l c h / 4%)",
          "0 10px 30px -5px oklch(from var(--foreground) l c h / 8%)",
        ].join(", "),
        animation: "loginFadeIn 0.5s ease-out 0.1s both",
      }}
    >
      {children}
    </div>
  );
}

// ─── Verification Code Input ────────────────────────────────────────────────

function CodeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  const focusInput = useCallback((index: number) => {
    inputsRef.current[index]?.focus();
  }, []);

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const arr = digits.slice();
      if (arr[index]) {
        arr[index] = "";
      } else if (index > 0) {
        arr[index - 1] = "";
        focusInput(index - 1);
      }
      onChange(arr.join(""));
    } else if (e.key === "ArrowLeft" && index > 0) {
      focusInput(index - 1);
    } else if (e.key === "ArrowRight" && index < 5) {
      focusInput(index + 1);
    }
  };

  const handleInput = (
    index: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const char = e.target.value.replace(/\D/g, "").slice(-1);
    if (!char) return;
    const arr = digits.slice();
    arr[index] = char;
    onChange(arr.join(""));
    if (index < 5) focusInput(index + 1);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (pasted) {
      onChange(pasted);
      focusInput(Math.min(pasted.length, 5));
    }
  };

  const digitStyle = (filled: boolean): React.CSSProperties => ({
    width: "2.75rem",
    height: "3.25rem",
    textAlign: "center" as const,
    fontSize: "1.5rem",
    fontWeight: 600,
    fontFamily: '"SF Mono", "Fira Code", monospace',
    borderRadius: "0.75rem",
    border: `1.5px solid ${filled ? "var(--primary)" : "var(--border)"}`,
    background: filled
      ? "oklch(from var(--primary) l c h / 5%)"
      : "oklch(from var(--background) l c h / 60%)",
    color: "var(--foreground)",
    outline: "none",
    transition: "all 0.2s ease",
    caretColor: "var(--primary)",
  });

  return (
    <div className="flex justify-center gap-2" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          disabled={disabled}
          autoFocus={i === 0}
          onChange={(e) => handleInput(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          style={digitStyle(!!d)}
          className="focus:ring-3 focus:ring-primary/15 focus:border-primary disabled:opacity-50"
        />
      ))}
    </div>
  );
}

// ─── Inline keyframes (injected once) ───────────────────────────────────────

const styleId = "login-keyframes";
if (typeof document !== "undefined" && !document.getElementById(styleId)) {
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `@keyframes loginFadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`;
  document.head.appendChild(style);
}

// ─── Loading / Pending ──────────────────────────────────────────────────────

function LoginPending() {
  const { t } = useTranslation("auth");
  return (
    <LoginLayout>
      <GlassCard>
        <LogoBanner subtitle={t("signInToWorkspace")} />
        <div className="space-y-5">
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-4 w-24 mx-auto rounded" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      </GlassCard>
    </LoginLayout>
  );
}

export const Route = createFileRoute("/login")({
  component: Login,
  pendingComponent: LoginPending,
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    return {
      redirect: (search.redirect as string) || "/",
      invite: (search.invite as string) || undefined,
      desktopSessionId: (search.desktopSessionId as string) || undefined,
    };
  },
});

// ─── Desktop Mode ───────────────────────────────────────────────────────────

function DesktopLoginView() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const createSession = useCreateDesktopSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const pendingSessionId = localStorage.getItem("pending_desktop_session_id");
    if (pendingSessionId) {
      setSessionId(pendingSessionId);
    }
  }, []);

  useLoginPolling(
    sessionId,
    () => {
      localStorage.removeItem("pending_desktop_session_id");
      navigate({ to: "/" });
    },
    () => {
      setSessionExpired(true);
      localStorage.removeItem("pending_desktop_session_id");
    },
  );

  const handleSignInWithBrowser = async () => {
    setSessionExpired(false);
    try {
      const result = await createSession.mutateAsync();
      setSessionId(result.sessionId);
      localStorage.setItem("pending_desktop_session_id", result.sessionId);
      const appUrl = import.meta.env.VITE_APP_URL;
      if (appUrl) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        const url = `${appUrl}/login?desktopSessionId=${result.sessionId}`;
        console.log("[desktop-login] opening URL:", url);
        await openUrl(url);
      } else {
        console.error("[desktop-login] VITE_APP_URL is not set");
      }
    } catch (err) {
      console.error("[desktop-login] failed to open browser:", err);
    }
  };

  const handleOpenBrowser = async () => {
    if (!sessionId || sessionExpired) {
      await handleSignInWithBrowser();
      return;
    }
    const appUrl = import.meta.env.VITE_APP_URL;
    if (appUrl) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      const url = `${appUrl}/login?desktopSessionId=${sessionId}`;
      await openUrl(url);
    }
  };

  // Waiting state: session exists and polling is active
  if (sessionId && !sessionExpired) {
    return (
      <LoginLayout>
        <GlassCard>
          <LogoBanner subtitle={t("tagline")} />
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-primary animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-foreground font-medium text-lg">
                {t("waitingForAuth")}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {t("completeBrowserAuth")}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={handleOpenBrowser}
              className="text-sm"
            >
              <Monitor className="w-4 h-4 mr-2" />
              {t("signInWithBrowser")}
            </Button>
          </div>
        </GlassCard>
      </LoginLayout>
    );
  }

  // Session expired
  if (sessionExpired) {
    return (
      <LoginLayout>
        <GlassCard>
          <LogoBanner subtitle={t("tagline")} />
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-sm text-muted-foreground">
              {t("sessionExpired")}
            </p>
            <Button
              onClick={handleSignInWithBrowser}
              disabled={createSession.isPending}
              className="w-full h-12 text-base font-semibold rounded-xl"
            >
              {createSession.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <Monitor className="w-5 h-5 mr-2" />
              )}
              {t("accessToTeam9")}
            </Button>
          </div>
        </GlassCard>
      </LoginLayout>
    );
  }

  // Initial state: no session yet
  return (
    <LoginLayout>
      <GlassCard>
        <LogoBanner subtitle={t("tagline")} />
        <div className="flex flex-col items-center">
          <Button
            onClick={handleOpenBrowser}
            disabled={createSession.isPending}
            className="w-full h-12 text-base font-semibold rounded-xl"
          >
            {createSession.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
            ) : (
              <Monitor className="w-5 h-5 mr-2" />
            )}
            {t("accessToTeam9")}
          </Button>
          <p className="text-center text-sm text-muted-foreground mt-4">
            {t("openBrowserHint")}
          </p>
        </div>
      </GlassCard>
    </LoginLayout>
  );
}

// ─── Web Browser Mode ───────────────────────────────────────────────────────

type AuthState =
  | "idle"
  | "need_display_name"
  | "code_sent"
  | "verifying_code"
  | "authenticated";

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function WebLoginView() {
  const { t, i18n } = useTranslation("auth");
  const turnstileLanguage = useMemo(
    () => toTurnstileLanguage(i18n.language || "en"),
    [i18n.language],
  );
  const navigate = useNavigate();
  const { redirect, invite, desktopSessionId } = Route.useSearch();

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | undefined>();
  const [countdown, setCountdown] = useState(0);
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const authCompletedInSession = useRef(false);
  const lastAutoVerifyAttempt = useRef<string | null>(null);
  const authMethodRef = useRef<"email" | "google">("email");
  const postAuthRedirectMode = useRef<"default" | "home">("default");
  const pageViewFiredRef = useRef(false);

  const { client: phClient } = useTeam9PostHog();

  const authStart = useAuthStart();
  const verifyCode = useVerifyCode();
  const googleAuth = useGoogleAuth();
  const completeDesktop = useCompleteDesktopSession();
  const { data: currentUser, isLoading } = useCurrentUser();
  const { data: invitationInfo } = useInvitationInfo(invite);

  const navigateToPostAuthDestination = useCallback(
    (options?: { preferHome?: boolean }) => {
      if (invite) {
        navigate({
          to: "/invite/$code",
          params: { code: invite },
          replace: true,
        });
        return;
      }

      // Navigating to "/" forces a double pass through _authenticated's
      // beforeLoad (via _authenticated/index.tsx's redirect to /channels),
      // which mutates Zustand mid-transition and races the router state
      // machine. Skip it when there's no explicit deep link.
      const hasDeepLink = redirect && redirect !== "/";
      const destination =
        options?.preferHome || !hasDeepLink ? "/channels" : redirect;
      navigate({
        to: destination as never,
        replace: true,
      });
    },
    [invite, navigate, redirect],
  );

  const navigateAfterAuth = useCallback(async () => {
    if (authCompletedInSession.current) {
      return;
    }

    authCompletedInSession.current = true;

    if (desktopSessionId) {
      try {
        await completeDesktop.mutateAsync({
          sessionId: desktopSessionId,
        });
      } catch {
        // Desktop session failed/expired
      }
      setAuthState("authenticated");
      return;
    }

    setAuthState("authenticated");
  }, [completeDesktop, desktopSessionId]);

  useEffect(() => {
    if (!localStorage.getItem("auth_token")) return;
    if (!currentUser || isLoading || authCompletedInSession.current) return;
    void navigateAfterAuth();
  }, [currentUser, isLoading, navigateAfterAuth]);

  useEffect(() => {
    if (authState !== "authenticated" || desktopSessionId) return;

    const frameId = window.requestAnimationFrame(() => {
      navigateToPostAuthDestination({
        preferHome: postAuthRedirectMode.current === "home",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [authState, desktopSessionId, navigateToPostAuthDestination]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  useEffect(() => {
    if (pageViewFiredRef.current) return;
    pageViewFiredRef.current = true;
    captureWithBridge(phClient, EVENTS.SIGNUP_PAGE_VIEWED, {
      page_key: "signup",
    });
  }, [phClient]);

  const autoVerifyAttemptKey = useMemo(() => {
    if (code.length !== 6 || !challengeId) return null;
    return `${challengeId}:${code}`;
  }, [challengeId, code]);

  useEffect(() => {
    if (!autoVerifyAttemptKey) {
      lastAutoVerifyAttempt.current = null;
      return;
    }
    if (!challengeId) return;
    if (authState !== "code_sent" || verifyCode.isPending) return;
    if (lastAutoVerifyAttempt.current === autoVerifyAttemptKey) return;

    lastAutoVerifyAttempt.current = autoVerifyAttemptKey;
    const currentChallengeId = challengeId;

    const doVerify = async () => {
      setError("");
      try {
        postAuthRedirectMode.current = "home";
        setAuthState("verifying_code");
        const authResponse = await verifyCode.mutateAsync({
          email,
          challengeId: currentChallengeId,
          code,
        });
        if (authResponse.isNewUser) {
          captureWithBridge(phClient, EVENTS.SIGNUP_COMPLETED, {
            signup_method: "email",
          });
        }
        await navigateAfterAuth();
      } catch (err: unknown) {
        setAuthState("code_sent");
        setError(getErrorMessage(err, t("verificationFailed")));
      }
    };

    void doVerify();
  }, [
    authState,
    autoVerifyAttemptKey,
    challengeId,
    code,
    email,
    navigateAfterAuth,
    phClient,
    t,
    verifyCode,
  ]);

  const handleContinueInBrowser = () => {
    navigateToPostAuthDestination({
      preferHome: postAuthRedirectMode.current === "home",
    });
  };

  useEffect(() => {
    if (authState === "authenticated" && desktopSessionId) {
      const redirect = () => {
        window.location.href = `team9://auth-complete?sessionId=${desktopSessionId}`;
      };

      import("posthog-js")
        .then(({ default: posthog }) => {
          if (posthog.__loaded) {
            return (
              posthog as unknown as { flush: () => Promise<void> }
            ).flush();
          }
        })
        .then(redirect)
        .catch(redirect);
    }
  }, [authState, desktopSessionId]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    captureWithBridge(phClient, EVENTS.SIGNUP_BUTTON_CLICKED, {
      signup_method: "email",
    });

    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError(t("turnstileNotReady"));
      return;
    }

    if (invite) {
      localStorage.setItem("pending_invite_code", invite);
    }

    try {
      const result = await authStart.mutateAsync({
        email,
        ...(authState === "need_display_name" ? { displayName } : {}),
        signupSource: invite ? "invite" : "self",
        ...(turnstileToken ? { turnstileToken } : {}),
      });

      if (result.action === "need_display_name") {
        setAuthState("need_display_name");
      } else if (result.action === "code_sent") {
        setChallengeId(result.challengeId!);
        setDevCode(result.verificationCode);
        setAuthState("code_sent");
        setCountdown(60);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("loginFailed")));
    } finally {
      turnstileRef.current?.reset();
      setTurnstileToken(null);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!challengeId) return;

    try {
      postAuthRedirectMode.current = "home";
      setAuthState("verifying_code");
      const authResponse = await verifyCode.mutateAsync({
        email,
        challengeId,
        code,
      });
      if (authResponse.isNewUser) {
        captureWithBridge(phClient, EVENTS.SIGNUP_COMPLETED, {
          signup_method: "email",
        });
      }
      await navigateAfterAuth();
    } catch (err: unknown) {
      setAuthState("code_sent");
      setError(getErrorMessage(err, t("verificationFailed")));
    }
  };

  const handleResendCode = async () => {
    setError("");
    // Backend recognizes the email's prior Turnstile verification via Redis
    // cache, so resend does not need a fresh widget token.
    try {
      const result = await authStart.mutateAsync({
        email,
        ...(displayName ? { displayName } : {}),
        signupSource: invite ? "invite" : "self",
      });
      if (result.action === "code_sent") {
        setChallengeId(result.challengeId!);
        setDevCode(result.verificationCode);
        setCountdown(60);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("loginFailed")));
    }
  };

  const handleGoogleSuccess = async (credentialResponse: {
    credential?: string;
  }) => {
    if (!credentialResponse.credential) return;
    captureWithBridge(phClient, EVENTS.SIGNUP_BUTTON_CLICKED, {
      signup_method: "google",
    });
    setError("");

    if (invite) {
      localStorage.setItem("pending_invite_code", invite);
    }

    authMethodRef.current = "google";
    postAuthRedirectMode.current = "default";

    // Google ID tokens are cryptographically signed and already carry
    // Google's own bot/abuse protection, so we skip Turnstile here.
    try {
      const result = await googleAuth.mutateAsync({
        credential: credentialResponse.credential,
        signupSource: invite ? "invite" : "self",
      });
      if (result.isNewUser) {
        captureWithBridge(phClient, EVENTS.SIGNUP_COMPLETED, {
          signup_method: "google",
        });
      }
      await navigateAfterAuth();
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("googleLoginFailed")));
    }
  };

  const handleChangeEmail = () => {
    setAuthState("idle");
    setCode("");
    setChallengeId(null);
    setDevCode(undefined);
    setError("");
    setDisplayName("");
    setTurnstileToken(null);
    postAuthRedirectMode.current = "default";
  };

  // Loading state
  if (googleAuth.isPending || completeDesktop.isPending) {
    return (
      <LoginLayout>
        <GlassCard>
          <LogoBanner />
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-primary animate-spin" />
            </div>
            <p className="text-muted-foreground text-base font-medium">
              {t("signingIn")}
            </p>
          </div>
        </GlassCard>
      </LoginLayout>
    );
  }

  // Desktop session intermediate page
  if (authState === "authenticated" && desktopSessionId) {
    return (
      <LoginLayout>
        <GlassCard className="text-center">
          <LogoBanner />
          <p className="text-foreground font-medium text-lg mb-2">
            {t("clickOpenDesktopApp")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("notWorkingHint")}{" "}
            <button
              type="button"
              onClick={handleContinueInBrowser}
              className="text-blue-600 font-medium underline underline-offset-2 hover:text-blue-800 cursor-pointer"
            >
              {t("useInBrowser")}
            </button>
          </p>
        </GlassCard>
      </LoginLayout>
    );
  }

  if (authState === "authenticated") {
    return (
      <LoginLayout>
        <GlassCard>
          <LogoBanner />
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-primary animate-spin" />
            </div>
            <p className="text-muted-foreground text-base font-medium">
              {postAuthRedirectMode.current === "home" && !invite
                ? t("redirectingHome")
                : t("signingIn")}
            </p>
          </div>
        </GlassCard>
      </LoginLayout>
    );
  }

  // Code entry view
  if (authState === "code_sent" || authState === "verifying_code") {
    return (
      <LoginLayout>
        <GlassCard>
          <LogoBanner subtitle={t("checkYourInbox")} />
          <button
            type="button"
            onClick={handleChangeEmail}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-5 -mt-1"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("back")}
          </button>

          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Mail className="w-7 h-7 text-primary" />
            </div>
            <p className="text-muted-foreground text-sm">
              {t("codeSentMessage", { email })}
            </p>
          </div>

          {/* Dev mode: show code directly */}
          {devCode && (
            <div className="mb-6 p-4 bg-warning/10 border border-warning/30 rounded-xl text-center">
              <p className="text-sm text-warning font-medium mb-1">
                {t("devMode")}
              </p>
              <p className="text-2xl font-mono font-bold tracking-wider">
                {devCode}
              </p>
            </div>
          )}

          <form onSubmit={handleCodeSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-foreground text-center">
                {t("verificationCode")}
              </label>
              <CodeInput
                value={code}
                onChange={setCode}
                disabled={
                  verifyCode.isPending || authState === "verifying_code"
                }
              />
            </div>

            {error && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl text-sm text-center">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 font-semibold text-base rounded-xl"
              disabled={
                verifyCode.isPending ||
                authState === "verifying_code" ||
                code.length < 6
              }
            >
              {verifyCode.isPending || authState === "verifying_code" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  {t("signingIn")}
                </>
              ) : (
                t("verifyAndSignIn")
              )}
            </Button>
          </form>

          <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/50">
            <button
              type="button"
              onClick={handleChangeEmail}
              className="text-sm text-primary font-medium hover:underline"
            >
              {t("changeEmail")}
            </button>
            <button
              type="button"
              onClick={handleResendCode}
              disabled={authStart.isPending || countdown > 0}
              className="text-sm text-primary font-medium hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              {countdown > 0
                ? t("resendIn", { seconds: countdown })
                : authStart.isPending
                  ? t("sending")
                  : t("resendCode")}
            </button>
          </div>
        </GlassCard>

        {/* Email Quick Links */}
        {!devCode && (
          <div
            className="flex items-center justify-center gap-3 mt-6"
            style={{ animation: "loginFadeIn 0.5s ease-out 0.25s both" }}
          >
            {MAIL_QUICK_LINKS.map((provider) => (
              <a
                key={provider.name}
                href={provider.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-all"
                style={{
                  background: "oklch(from var(--background) l c h / 60%)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid oklch(from var(--border) l c h / 50%)",
                }}
              >
                <Mail className="w-4 h-4" />
                <span>
                  {t("openMailProvider", { provider: provider.name })}
                </span>
              </a>
            ))}
          </div>
        )}
      </LoginLayout>
    );
  }

  // Main login form (idle or need_display_name)
  return (
    <LoginLayout>
      {/* Invite banner */}
      {invite && invitationInfo?.isValid && (
        <div
          className="rounded-2xl p-4 mb-4 text-center"
          style={{
            background: "oklch(from var(--primary) l c h / 8%)",
            border: "1px solid oklch(from var(--primary) l c h / 15%)",
            animation: "loginFadeIn 0.5s ease-out",
          }}
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-primary">
            {t("invitedToWorkspace")}
          </p>
          <p className="text-lg font-bold text-foreground">
            {invitationInfo.workspaceName}
          </p>
          {invitationInfo.invitedBy && (
            <p className="text-xs text-muted-foreground mt-1">
              {t("invitedBy", { name: invitationInfo.invitedBy })}
            </p>
          )}
        </div>
      )}

      <GlassCard>
        <LogoBanner subtitle={t("signInToWorkspace")} />

        {/* Google Login */}
        {googleClientId && (
          <>
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError(t("googleLoginFailed"))}
                size="large"
                width="100%"
                text="continue_with"
              />
            </div>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background/80 px-3 text-muted-foreground">
                  {t("orContinueWith")}
                </span>
              </div>
            </div>
          </>
        )}

        <form onSubmit={handleEmailSubmit} className="space-y-5">
          {/* Email Field */}
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="block text-sm font-semibold text-foreground"
            >
              {t("email")}
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              className="w-full h-11 px-3 rounded-xl"
              required
              autoFocus={authState === "idle"}
              disabled={authState === "need_display_name"}
            />
          </div>

          {/* Display Name Field (shown for new users) */}
          {authState === "need_display_name" && (
            <div
              className="space-y-2"
              style={{ animation: "loginFadeIn 0.3s ease-out" }}
            >
              <label
                htmlFor="displayName"
                className="block text-sm font-semibold text-foreground"
              >
                {t("displayName")}
              </label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("displayNamePlaceholder")}
                className="w-full h-11 px-3 rounded-xl"
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {t("displayNameHint")}
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          {/* Turnstile Widget */}
          {TURNSTILE_SITE_KEY && (
            <div className="flex justify-center">
              <Turnstile
                ref={turnstileRef}
                siteKey={TURNSTILE_SITE_KEY}
                options={{
                  action: "auth-start",
                  theme: "auto",
                  language: turnstileLanguage,
                }}
                onSuccess={setTurnstileToken}
                onError={() => setTurnstileToken(null)}
                onExpire={() => setTurnstileToken(null)}
              />
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base rounded-xl"
            disabled={
              authStart.isPending ||
              (authState === "need_display_name" && !displayName.trim()) ||
              (!!TURNSTILE_SITE_KEY && !turnstileToken)
            }
          >
            {authStart.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                {t("sending")}
              </>
            ) : (
              t("continueWithEmail")
            )}
          </Button>

          {/* Change email link when in need_display_name state */}
          {authState === "need_display_name" && (
            <button
              type="button"
              onClick={handleChangeEmail}
              className="block w-full text-center text-sm text-primary font-medium hover:underline"
            >
              {t("changeEmail")}
            </button>
          )}
        </form>
      </GlassCard>

      {/* Footer */}
      <div
        className="text-center mt-8 text-xs text-muted-foreground"
        style={{ animation: "loginFadeIn 0.5s ease-out 0.3s both" }}
      >
        <p>
          {t("termsAgreement")}{" "}
          <Link to="/terms-of-service" className="text-primary hover:underline">
            {t("termsOfService")}
          </Link>{" "}
          {t("and")}{" "}
          <Link to="/privacy" className="text-primary hover:underline">
            {t("privacyPolicy")}
          </Link>
        </p>
      </div>
    </LoginLayout>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function Login() {
  if (IS_TAURI) {
    return <DesktopLoginView />;
  }
  return <WebLoginView />;
}
