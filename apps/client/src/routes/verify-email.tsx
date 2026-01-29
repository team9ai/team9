import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useVerifyEmail } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

type VerifyEmailSearch = {
  token?: string;
};

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmail,
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => {
    return {
      token: search.token as string | undefined,
    };
  },
});

function VerifyEmail() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const verifyEmail = useVerifyEmail();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage(t("invalidVerificationLink"));
      return;
    }

    const verify = async () => {
      try {
        await verifyEmail.mutateAsync(token);
        setStatus("success");
        // Redirect to home after 3 seconds
        setTimeout(() => {
          navigate({ to: "/" });
        }, 3000);
      } catch (err: any) {
        setStatus("error");
        setErrorMessage(
          err?.response?.data?.message ||
            err?.message ||
            t("verificationFailed"),
        );
      }
    };

    verify();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Team9</h1>
        </div>

        {/* Verification Status Card */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center">
          {status === "loading" && (
            <>
              <Loader2 className="w-16 h-16 mx-auto text-purple-600 animate-spin mb-4" />
              <h2 className="text-xl font-semibold">{t("verifyingEmail")}</h2>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle className="w-16 h-16 mx-auto text-green-500 mb-4" />
              <h2 className="text-xl font-semibold text-green-700 mb-2">
                {t("emailVerified")}
              </h2>
              <p className="text-gray-600 mb-6">{t("emailVerifiedMessage")}</p>
              <p className="text-sm text-gray-500">{t("redirectingHome")}</p>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="w-16 h-16 mx-auto text-red-500 mb-4" />
              <h2 className="text-xl font-semibold text-red-700 mb-2">
                {t("verificationFailed")}
              </h2>
              <p className="text-gray-600 mb-6">{errorMessage}</p>
              <div className="space-y-3">
                <Link to="/login" className="block">
                  <Button className="w-full">{t("backToLogin")}</Button>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
