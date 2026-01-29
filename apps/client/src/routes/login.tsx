import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  useLogin,
  useCurrentUser,
  useResendVerification,
} from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

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
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
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

function ResendVerificationButton({ email }: { email: string }) {
  const { t } = useTranslation("auth");
  const resendVerification = useResendVerification();
  const [countdown, setCountdown] = useState(0);
  const [sent, setSent] = useState(false);

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
      setSent(true);
    } catch {
      // Error handled by mutation
    }
  };

  if (sent && countdown === 0) {
    return (
      <p className="text-sm text-green-600 mt-2">
        {t("verificationEmailSentSuccess")}
      </p>
    );
  }

  return (
    <Button
      variant="link"
      onClick={handleResend}
      disabled={resendVerification.isPending || countdown > 0}
      className="p-0 h-auto text-purple-600 hover:text-purple-700"
    >
      {countdown > 0
        ? t("resendIn", { seconds: countdown })
        : resendVerification.isPending
          ? t("sending")
          : t("resendVerificationEmail")}
    </Button>
  );
}

function Login() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

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
    setUnverifiedEmail(null);

    try {
      await login.mutateAsync({
        email,
        password,
      });
      // Redirect to the original page or home page after successful login
      navigate({ to: redirect || "/" });
    } catch (err: any) {
      const errorMessage =
        err?.response?.data?.message || err?.message || t("loginFailed");

      // Check if the error is about unverified email
      if (
        errorMessage.toLowerCase().includes("not verified") ||
        errorMessage.includes("未验证")
      ) {
        setUnverifiedEmail(email);
      }

      setError(errorMessage);
    }
  };

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

            {/* Password Field */}
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-gray-900"
              >
                {t("password")}
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                className="w-full h-11 px-3"
                required
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                {error}
                {unverifiedEmail && (
                  <div className="mt-2">
                    <ResendVerificationButton email={unverifiedEmail} />
                  </div>
                )}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-base"
              disabled={login.isPending}
            >
              {login.isPending ? t("signingIn") : t("signInWithEmail")}
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
