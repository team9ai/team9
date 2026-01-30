import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useLogin, useCurrentUser } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail } from "lucide-react";

type LoginSearch = {
  redirect?: string;
};

function LoginPending() {
  const { t } = useTranslation("auth");
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Team9</h1>
          <p className="text-gray-600 text-lg">{t("signInToWorkspace")}</p>
        </div>

        {/* Loading Skeleton */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
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
    };
  },
});

function LoginLinkSentView({ email }: { email: string }) {
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
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Team9</h1>
          <p className="text-gray-600 text-lg">{t("loginLinkSent")}</p>
        </div>

        {/* Login Link Sent Card */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center">
          <div className="mb-6">
            <Mail className="w-16 h-16 mx-auto text-purple-600" />
          </div>
          <h2 className="text-xl font-semibold mb-4">{t("loginLinkSent")}</h2>
          <p className="text-gray-600 mb-6">
            {t("loginLinkSentMessage", { email })}
          </p>
          <p className="text-sm text-gray-500 mb-6">{t("loginLinkSentHint")}</p>
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

        {/* Back to Login Link */}
        <div className="text-center mt-6">
          <Link
            to="/register"
            className="text-purple-600 hover:underline font-medium"
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
  const { redirect } = Route.useSearch();
  const login = useLogin();
  const { data: currentUser, isLoading } = useCurrentUser();

  // Redirect if already logged in
  useEffect(() => {
    if (currentUser && !isLoading) {
      navigate({ to: redirect || "/" });
    }
  }, [currentUser, isLoading, navigate, redirect]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

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
    return <LoginLinkSentView email={sentEmail} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Team9</h1>
          <p className="text-gray-600 text-lg">{t("signInToWorkspace")}</p>
        </div>

        {/* Login Form */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email Field */}
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="block text-sm font-semibold text-gray-900"
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
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-base"
              disabled={login.isPending}
            >
              {login.isPending ? t("sendingLoginLink") : t("sendLoginLink")}
            </Button>
          </form>
        </div>

        {/* Sign Up Link */}
        <div className="text-center mt-6">
          <p className="text-gray-600 text-sm">
            {t("dontHaveAccount")}{" "}
            <Link
              to="/register"
              className="text-purple-600 hover:underline font-medium"
            >
              {t("createAccount")}
            </Link>
          </p>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-xs text-gray-500">
          <p>
            {t("termsAgreement")}{" "}
            <a href="#" className="text-purple-600 hover:underline">
              {t("termsOfService")}
            </a>{" "}
            {t("and")}{" "}
            <a href="#" className="text-purple-600 hover:underline">
              {t("privacyPolicy")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
