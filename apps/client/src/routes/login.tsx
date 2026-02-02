import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useLogin, useCurrentUser } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail } from "lucide-react";

const MAIL_QUICK_LINKS = [
  { name: "Gmail", url: "https://mail.google.com" },
  { name: "Outlook", url: "https://outlook.live.com" },
];

function EmailQuickLinks() {
  const { t } = useTranslation("auth");

  return (
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
          <span>{t("openMailProvider", { provider: provider.name })}</span>
        </a>
      ))}
    </div>
  );
}

type LoginSearch = {
  redirect?: string;
  invite?: string;
};

function LoginPending() {
  const { t } = useTranslation("auth");
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          <p className="text-muted-foreground text-lg">
            {t("signInToWorkspace")}
          </p>
        </div>

        {/* Loading Skeleton */}
        <div className="bg-background border border-border rounded-lg shadow-sm p-8">
          <div className="space-y-5">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full" />
            </div>
            <Skeleton className="h-11 w-full" />
          </div>
        </div>

        {/* Sign Up Link */}
        <div className="text-center mt-6">
          <Skeleton className="h-4 w-48 mx-auto" />
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
    };
  },
});

function LoginLinkSentView({
  email,
  invite,
}: {
  email: string;
  invite?: string;
}) {
  const { t } = useTranslation("auth");
  const login = useLogin();
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleResend = async () => {
    try {
      await login.mutateAsync({ email });
      setCountdown(60);
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          <p className="text-muted-foreground text-lg">{t("loginLinkSent")}</p>
        </div>

        {/* Login Link Sent Card */}
        <div className="bg-background border border-border rounded-lg shadow-sm p-8 text-center">
          <div className="mb-6">
            <Mail className="w-16 h-16 mx-auto text-primary" />
          </div>
          <h2 className="text-xl font-semibold mb-4">{t("loginLinkSent")}</h2>
          <p className="text-muted-foreground mb-6">
            {t("loginLinkSentMessage", { email })}
          </p>
          <p className="text-sm text-muted-foreground mb-2">
            {t("loginLinkSentHint")}
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            {t("checkSpamFolder")}
          </p>
          <Button
            variant="outline"
            onClick={handleResend}
            disabled={login.isPending || countdown > 0}
            className="w-full"
          >
            {countdown > 0
              ? t("resendIn", { seconds: countdown })
              : login.isPending
                ? t("sending")
                : t("resendLoginLink")}
          </Button>
        </div>

        {/* Email Quick Links */}
        <EmailQuickLinks />

        {/* Back to Login Link */}
        <div className="text-center mt-6">
          <Link
            to="/register"
            search={invite ? { invite } : {}}
            className="text-primary hover:underline font-medium"
          >
            {t("createAccount")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function Login() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");

  const navigate = useNavigate();
  const { redirect, invite } = Route.useSearch();
  const login = useLogin();
  const { data: currentUser, isLoading } = useCurrentUser();

  // Redirect if already logged in
  useEffect(() => {
    if (currentUser && !isLoading) {
      if (invite) {
        navigate({ to: "/invite/$code", params: { code: invite } });
      } else {
        navigate({ to: redirect || "/" });
      }
    }
  }, [currentUser, isLoading, navigate, redirect, invite]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Save invite code to localStorage to bridge the email verification gap
    if (invite) {
      localStorage.setItem("pending_invite_code", invite);
    }

    try {
      await login.mutateAsync({ email });
      setSentEmail(email);
      setLinkSent(true);
    } catch (err: any) {
      const errorMessage =
        err?.response?.data?.message || err?.message || t("loginFailed");
      setError(errorMessage);
    }
  };

  // Show login link sent view
  if (linkSent) {
    return <LoginLinkSentView email={sentEmail} invite={invite} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          <p className="text-muted-foreground text-lg">
            {t("signInToWorkspace")}
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-background border border-border rounded-lg shadow-sm p-8">
          <form onSubmit={handleLogin} className="space-y-5">
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
                autoFocus
              />
            </div>

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
              disabled={login.isPending}
            >
              {login.isPending ? t("sendingLoginLink") : t("sendLoginLink")}
            </Button>
          </form>
        </div>

        {/* Sign Up Link */}
        <div className="text-center mt-6">
          <p className="text-muted-foreground text-sm">
            {t("dontHaveAccount")}{" "}
            <Link
              to="/register"
              search={invite ? { invite } : {}}
              className="text-primary hover:underline font-medium"
            >
              {t("createAccount")}
            </Link>
          </p>
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
