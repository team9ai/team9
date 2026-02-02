import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  useRegister,
  useCurrentUser,
  useResendVerification,
} from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, Users } from "lucide-react";
import workspaceApi from "@/services/api/workspace";

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

function RegisterPending() {
  const { t } = useTranslation("auth");
  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          <p className="text-muted-foreground text-lg">
            {t("createYourAccount")}
          </p>
        </div>

        {/* Loading Skeleton */}
        <div className="bg-background border border-border rounded-lg shadow-sm p-8">
          <div className="space-y-5">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-11 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full" />
            </div>
            <Skeleton className="h-11 w-full" />
          </div>
        </div>

        {/* Sign In Link */}
        <div className="text-center mt-6">
          <Skeleton className="h-4 w-48 mx-auto" />
        </div>
      </div>
    </div>
  );
}

type RegisterSearch = {
  invite?: string;
  redirect?: string;
};

export const Route = createFileRoute("/register")({
  component: Register,
  pendingComponent: RegisterPending,
  validateSearch: (search: Record<string, unknown>): RegisterSearch => {
    return {
      invite: (search.invite as string) || undefined,
      redirect: (search.redirect as string) || undefined,
    };
  },
});

function ResendVerificationButton({ email }: { email: string }) {
  const { t } = useTranslation("auth");
  const resendVerification = useResendVerification();
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleResend = async () => {
    try {
      await resendVerification.mutateAsync(email);
      setCountdown(60);
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleResend}
      disabled={resendVerification.isPending || countdown > 0}
      className="w-full"
    >
      {countdown > 0
        ? t("resendIn", { seconds: countdown })
        : resendVerification.isPending
          ? t("sending")
          : t("resendVerificationEmail")}
    </Button>
  );
}

function VerificationSentView({
  email,
  isResend = false,
}: {
  email: string;
  isResend?: boolean;
}) {
  const { t } = useTranslation("auth");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          <p className="text-muted-foreground text-lg">
            {t("verifyYourEmail")}
          </p>
        </div>

        {/* Verification Sent Card */}
        <div className="bg-background border border-border rounded-lg shadow-sm p-8 text-center">
          <div className="mb-6">
            <Mail className="w-16 h-16 mx-auto text-primary" />
          </div>
          <h2 className="text-xl font-semibold mb-4">
            {isResend ? t("emailAlreadyRegistered") : t("checkYourInbox")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {isResend
              ? t("emailAlreadyRegisteredHint", { email })
              : t("verificationEmailSent", { email })}
          </p>
          <p className="text-sm text-muted-foreground mb-2">
            {t("verificationEmailHint")}
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            {t("checkSpamFolder")}
          </p>
          <ResendVerificationButton email={email} />
        </div>

        {/* Email Quick Links */}
        <EmailQuickLinks />
      </div>
    </div>
  );
}

function Register() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [emailAlreadyExists, setEmailAlreadyExists] = useState(false);

  const navigate = useNavigate();
  const { invite } = Route.useSearch();
  const register = useRegister();
  const { data: currentUser, isLoading } = useCurrentUser();

  // Fetch invite info if invite code is present
  const { data: inviteInfo } = useQuery({
    queryKey: ["invitation", invite],
    queryFn: () => workspaceApi.getInvitationInfo(invite!),
    enabled: !!invite,
  });

  // Redirect if already logged in
  useEffect(() => {
    if (currentUser && !isLoading) {
      if (invite) {
        navigate({ to: "/invite/$code", params: { code: invite } });
      } else {
        navigate({ to: "/" });
      }
    }
  }, [currentUser, isLoading, navigate, invite]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (username.length < 3) {
      setError(t("usernameTooShort"));
      return;
    }

    // Save invite code to localStorage to bridge the email verification gap
    if (invite) {
      localStorage.setItem("pending_invite_code", invite);
    }

    try {
      const result = await register.mutateAsync({
        email,
        username,
      });
      // Show verification sent view
      setRegisteredEmail(result.email);
      setRegistrationSuccess(true);
    } catch (err: any) {
      const errorMessage =
        err?.response?.data?.message || err?.message || t("registerFailed");

      // Check if email already exists (user may not have received verification email)
      if (errorMessage.toLowerCase().includes("email already exists")) {
        setEmailAlreadyExists(true);
        setRegisteredEmail(email);
      } else {
        setError(errorMessage);
      }
    }
  };

  // Show verification sent view after successful registration
  if (registrationSuccess) {
    return <VerificationSentView email={registeredEmail} />;
  }

  // Show resend verification option if email already exists
  if (emailAlreadyExists) {
    return <VerificationSentView email={registeredEmail} isResend />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Team9</h1>
          <p className="text-muted-foreground text-lg">
            {t("createYourAccount")}
          </p>
        </div>

        {/* Registration Form */}
        <div className="bg-background border border-border rounded-lg shadow-sm p-8">
          {/* Invite banner */}
          {inviteInfo?.isValid && (
            <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-lg text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Users size={16} className="text-primary" />
                <p className="text-sm text-muted-foreground">
                  You've been invited to join
                </p>
              </div>
              <p className="text-lg font-semibold text-primary">
                {inviteInfo.workspaceName}
              </p>
              {inviteInfo.invitedBy && (
                <p className="text-xs text-muted-foreground mt-1">
                  Invited by {inviteInfo.invitedBy}
                </p>
              )}
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-5">
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
              <p className="text-xs text-muted-foreground">{t("emailHint")}</p>
            </div>

            {/* Username Field */}
            <div className="space-y-2">
              <label
                htmlFor="username"
                className="block text-sm font-semibold text-foreground"
              >
                {t("username")}
              </label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("usernamePlaceholder")}
                className="w-full h-11 px-3"
                required
                minLength={3}
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                {t("usernameHint")}
              </p>
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
              disabled={register.isPending}
            >
              {register.isPending ? t("creatingAccount") : t("createAccount")}
            </Button>
          </form>
        </div>

        {/* Sign In Link */}
        <div className="text-center mt-6">
          <p className="text-muted-foreground text-sm">
            {t("alreadyHaveAccount")}{" "}
            <Link
              to="/login"
              search={invite ? { invite } : {}}
              className="text-primary hover:underline font-medium"
            >
              {t("signIn")}
            </Link>
          </p>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-xs text-muted-foreground">
          <p>
            {t("createTermsAgreement")}{" "}
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
