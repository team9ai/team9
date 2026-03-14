import { useState, useEffect, useRef } from "react";
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
import { Mail, Loader2, Monitor, Users } from "lucide-react";

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const MAIL_QUICK_LINKS = [
  { name: "Gmail", url: "https://mail.google.com" },
  { name: "Outlook", url: "https://outlook.live.com" },
];

type LoginSearch = {
  redirect?: string;
  invite?: string;
  desktopSessionId?: string;
  pairCode?: string;
};

function LoginPending() {
  const { t } = useTranslation("auth");
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-100 px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          <p className="text-muted-foreground text-lg">
            {t("signInToWorkspace")}
          </p>
        </div>
        <div className="bg-background border border-border rounded-lg shadow-sm p-8">
          <div className="space-y-5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-4 w-24 mx-auto" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        </div>
      </div>
    </div>
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
      pairCode: (search.pairCode as string) || undefined,
    };
  },
});

// ─── Desktop Mode ───────────────────────────────────────────────────────────

function DesktopLoginView() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const createSession = useCreateDesktopSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Cold-start recovery: check localStorage for pending desktop session
  useEffect(() => {
    const pendingSessionId = localStorage.getItem("pending_desktop_session_id");
    const pendingPairCode = localStorage.getItem("pending_desktop_pair_code");
    if (pendingSessionId && pendingPairCode) {
      setSessionId(pendingSessionId);
      setPairCode(pendingPairCode);
    }
  }, []);

  // Poll for login session completion
  useLoginPolling(
    sessionId,
    () => {
      // Clear pending state
      localStorage.removeItem("pending_desktop_session_id");
      localStorage.removeItem("pending_desktop_pair_code");
      navigate({ to: "/" });
    },
    () => {
      // Session expired or not found
      setSessionExpired(true);
      localStorage.removeItem("pending_desktop_session_id");
      localStorage.removeItem("pending_desktop_pair_code");
    },
  );

  const handleSignInWithBrowser = async () => {
    setSessionExpired(false);
    try {
      const result = await createSession.mutateAsync();
      setSessionId(result.sessionId);
      setPairCode(result.pairCode);

      // Persist for cold-start recovery
      localStorage.setItem("pending_desktop_session_id", result.sessionId);
      localStorage.setItem("pending_desktop_pair_code", result.pairCode);

      // Open system browser
      const appUrl = import.meta.env.VITE_APP_URL;
      if (appUrl) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        const url = `${appUrl}/login?desktopSessionId=${result.sessionId}&pairCode=${result.pairCode}`;
        await openUrl(url);
      }
    } catch {
      // Error handled by mutation
    }
  };

  const handleRetry = () => {
    setSessionId(null);
    setPairCode(null);
    setSessionExpired(false);
    localStorage.removeItem("pending_desktop_session_id");
    localStorage.removeItem("pending_desktop_pair_code");
  };

  // Waiting state (after clicking sign in)
  if (sessionId && pairCode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-100 px-4">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          </div>
          <div className="bg-background border border-border rounded-lg shadow-sm p-8 text-center">
            {sessionExpired ? (
              <>
                <Monitor className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h2 className="text-xl font-semibold mb-2">
                  {t("sessionExpired")}
                </h2>
                <Button onClick={handleRetry} className="w-full mt-4">
                  {t("signInWithBrowser")}
                </Button>
              </>
            ) : (
              <>
                <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
                <h2 className="text-lg font-semibold mb-2">
                  {t("waitingForAuth")}
                </h2>
                <p className="text-muted-foreground text-sm mb-4">
                  {t("completeBrowserAuth")}
                </p>
                <div className="inline-block bg-muted px-6 py-3 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("pairCodeLabel")}
                  </p>
                  <p className="text-2xl font-mono font-bold tracking-wider">
                    {pairCode}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Initial landing page
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-100 px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          <p className="text-muted-foreground text-lg">
            Team collaboration, reimagined
          </p>
        </div>
        <div className="bg-background border border-border rounded-lg shadow-sm p-8">
          <Button
            onClick={handleSignInWithBrowser}
            disabled={createSession.isPending}
            className="w-full h-12 text-base font-semibold"
          >
            {createSession.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
            ) : (
              <Monitor className="w-5 h-5 mr-2" />
            )}
            {t("signInWithBrowser")}
          </Button>
          <p className="text-center text-sm text-muted-foreground mt-4">
            {t("openBrowserHint")}
          </p>
        </div>
      </div>
    </div>
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
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { redirect, invite, desktopSessionId, pairCode } = Route.useSearch();

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | undefined>();
  const [countdown, setCountdown] = useState(0);
  // Track whether auth was completed in this session (to avoid double desktop pairing)
  const authCompletedInSession = useRef(false);

  const authStart = useAuthStart();
  const verifyCode = useVerifyCode();
  const googleAuth = useGoogleAuth();
  const completeDesktop = useCompleteDesktopSession();
  const { data: currentUser, isLoading } = useCurrentUser();
  const { data: invitationInfo } = useInvitationInfo(invite);

  // Redirect if already logged in on page load (complete desktop pairing first if needed)
  // Skipped when auth was just completed in this session (navigateAfterAuth handles it)
  useEffect(() => {
    if (!currentUser || isLoading || authCompletedInSession.current) return;

    const completeAndRedirect = async () => {
      if (desktopSessionId && pairCode) {
        try {
          await completeDesktop.mutateAsync({
            sessionId: desktopSessionId,
            pairCode,
          });
        } catch {
          // Desktop session may have expired, continue normally
        }
        try {
          window.location.href = `team9://auth-complete?sessionId=${desktopSessionId}`;
        } catch {
          // Deeplink not handled
        }
      }

      if (invite) {
        navigate({ to: "/invite/$code", params: { code: invite } });
      } else {
        navigate({ to: redirect || "/" });
      }
    };

    completeAndRedirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, isLoading]);

  // Resend countdown
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const navigateAfterAuth = async () => {
    // Mark that auth was completed in this session so the useEffect doesn't double-fire
    authCompletedInSession.current = true;

    // Complete desktop session if applicable
    if (desktopSessionId && pairCode) {
      try {
        await completeDesktop.mutateAsync({
          sessionId: desktopSessionId,
          pairCode,
        });
        // Only trigger deeplink on successful completion
        try {
          window.location.href = `team9://auth-complete?sessionId=${desktopSessionId}`;
        } catch {
          // Deeplink not handled
        }
      } catch {
        // Desktop session failed/expired, continue to web navigation
      }
    }

    if (invite) {
      navigate({ to: "/invite/$code", params: { code: invite } });
    } else {
      navigate({ to: redirect || "/" });
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (invite) {
      localStorage.setItem("pending_invite_code", invite);
    }

    try {
      const result = await authStart.mutateAsync({
        email,
        ...(authState === "need_display_name" ? { displayName } : {}),
      });

      if (result.action === "need_display_name") {
        setAuthState("need_display_name");
      } else if (result.action === "code_sent") {
        setChallengeId(result.challengeId!);
        setDevCode(result.verificationCode);
        setAuthState("code_sent");
        setCountdown(60);
      }
    } catch (err: any) {
      const errorMessage =
        err?.response?.data?.message || err?.message || t("loginFailed");
      setError(errorMessage);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!challengeId) return;

    try {
      setAuthState("verifying_code");
      await verifyCode.mutateAsync({
        email,
        challengeId,
        code,
      });
      setAuthState("authenticated");
      await navigateAfterAuth();
    } catch (err: any) {
      setAuthState("code_sent");
      const errorMessage =
        err?.response?.data?.message || err?.message || t("verificationFailed");
      setError(errorMessage);
    }
  };

  const handleResendCode = async () => {
    setError("");
    try {
      const result = await authStart.mutateAsync({
        email,
        ...(displayName ? { displayName } : {}),
      });
      if (result.action === "code_sent") {
        setChallengeId(result.challengeId!);
        setDevCode(result.verificationCode);
        setCountdown(60);
      }
    } catch (err: any) {
      const errorMessage =
        err?.response?.data?.message || err?.message || t("loginFailed");
      setError(errorMessage);
    }
  };

  const handleGoogleSuccess = async (credentialResponse: {
    credential?: string;
  }) => {
    if (!credentialResponse.credential) return;
    setError("");

    if (invite) {
      localStorage.setItem("pending_invite_code", invite);
    }

    try {
      await googleAuth.mutateAsync(credentialResponse.credential);
      await navigateAfterAuth();
    } catch (err: any) {
      const errorMessage =
        err?.response?.data?.message || err?.message || t("googleLoginFailed");
      setError(errorMessage);
    }
  };

  const handleChangeEmail = () => {
    setAuthState("idle");
    setCode("");
    setChallengeId(null);
    setDevCode(undefined);
    setError("");
    setDisplayName("");
  };

  // Loading state for Google auth
  if (googleAuth.isPending || completeDesktop.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-100 px-4">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          </div>
          <div className="bg-background border border-border rounded-lg shadow-sm p-8">
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-muted-foreground text-base">
                {t("signingIn")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Code entry view
  if (authState === "code_sent" || authState === "verifying_code") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-100 px-4">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
            <p className="text-muted-foreground text-lg">
              {t("checkYourInbox")}
            </p>
          </div>

          {/* Desktop session banner */}
          {desktopSessionId && pairCode && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4 text-center">
              <p className="text-sm text-primary font-medium">
                {t("signingInToDesktop")} {pairCode}
              </p>
            </div>
          )}

          <div className="bg-background border border-border rounded-lg shadow-sm p-8">
            <div className="text-center mb-6">
              <Mail className="w-12 h-12 mx-auto text-primary mb-3" />
              <p className="text-muted-foreground">
                {t("codeSentMessage", { email })}
              </p>
            </div>

            {/* Dev mode: show code directly */}
            {devCode && (
              <div className="mb-6 p-4 bg-warning/10 border border-warning/30 rounded-lg text-center">
                <p className="text-sm text-warning font-medium mb-1">
                  Dev Mode
                </p>
                <p className="text-2xl font-mono font-bold tracking-wider">
                  {devCode}
                </p>
              </div>
            )}

            <form onSubmit={handleCodeSubmit} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="code"
                  className="block text-sm font-semibold text-foreground"
                >
                  {t("verificationCode")}
                </label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="w-full h-11 px-3 text-center text-lg tracking-widest font-mono"
                  maxLength={6}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                />
              </div>

              {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded text-sm">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11 font-semibold text-base"
                disabled={
                  verifyCode.isPending ||
                  authState === "verifying_code" ||
                  code.length < 6
                }
              >
                {verifyCode.isPending || authState === "verifying_code"
                  ? t("signingIn")
                  : t("verifyAndSignIn")}
              </Button>
            </form>

            <div className="flex items-center justify-between mt-4">
              <button
                type="button"
                onClick={handleChangeEmail}
                className="text-sm text-primary hover:underline"
              >
                {t("changeEmail")}
              </button>
              <button
                type="button"
                onClick={handleResendCode}
                disabled={authStart.isPending || countdown > 0}
                className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                {countdown > 0
                  ? t("resendIn", { seconds: countdown })
                  : authStart.isPending
                    ? t("sending")
                    : t("resendCode")}
              </button>
            </div>
          </div>

          {/* Email Quick Links */}
          {!devCode && (
            <div className="flex items-center justify-center gap-4 mt-6">
              {MAIL_QUICK_LINKS.map((provider) => (
                <a
                  key={provider.name}
                  href={provider.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 border border-border rounded-lg text-info font-medium hover:bg-muted transition-colors"
                >
                  <Mail className="w-5 h-5" />
                  <span>
                    {t("openMailProvider", { provider: provider.name })}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main login form (idle or need_display_name)
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-100 px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          <p className="text-muted-foreground text-lg">
            {t("signInToWorkspace")}
          </p>
        </div>

        {/* Invite banner */}
        {invite && invitationInfo?.isValid && (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mb-4 text-center">
            <Users className="w-8 h-8 mx-auto text-primary mb-2" />
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

        {/* Desktop session banner */}
        {desktopSessionId && pairCode && (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4 text-center">
            <p className="text-sm text-primary font-medium">
              {t("signingInToDesktop")} {pairCode}
            </p>
          </div>
        )}

        <div className="bg-background border border-border rounded-lg shadow-sm p-8">
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
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
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
                className="w-full h-11 px-3"
                required
                autoFocus={authState === "idle"}
                disabled={authState === "need_display_name"}
              />
            </div>

            {/* Display Name Field (shown for new users) */}
            {authState === "need_display_name" && (
              <div className="space-y-2">
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
                  className="w-full h-11 px-3"
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
              <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded text-sm">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base"
              disabled={
                authStart.isPending ||
                (authState === "need_display_name" && !displayName.trim())
              }
            >
              {authStart.isPending ? t("sending") : t("continueWithEmail")}
            </Button>

            {/* Change email link when in need_display_name state */}
            {authState === "need_display_name" && (
              <button
                type="button"
                onClick={handleChangeEmail}
                className="block w-full text-center text-sm text-primary hover:underline"
              >
                {t("changeEmail")}
              </button>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-xs text-muted-foreground">
          <p>
            {t("termsAgreement")}{" "}
            <Link
              to="/terms-of-service"
              className="text-primary hover:underline"
            >
              {t("termsOfService")}
            </Link>{" "}
            {t("and")}{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              {t("privacyPolicy")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function Login() {
  if (IS_TAURI) {
    return <DesktopLoginView />;
  }
  return <WebLoginView />;
}
