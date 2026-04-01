import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle, Loader2, MailCheck, XCircle } from "lucide-react";
import api from "@/services/api";
import { Button } from "@/components/ui/button";

type ConfirmEmailChangeSearch = {
  token?: string;
};

export const Route = createFileRoute("/confirm-email-change")({
  component: ConfirmEmailChange,
  validateSearch: (
    search: Record<string, unknown>,
  ): ConfirmEmailChangeSearch => ({
    token: search.token as string | undefined,
  }),
});

function ConfirmEmailChange() {
  const { t } = useTranslation("auth");
  const { token } = Route.useSearch();
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  const handleConfirm = async () => {
    if (!token || status === "submitting") {
      return;
    }

    try {
      setStatus("submitting");
      setErrorMessage("");
      await api.account.confirmEmailChange(token);
      setStatus("success");
    } catch (error: any) {
      setStatus("error");
      setErrorMessage(
        error?.response?.data?.message ||
          error?.message ||
          t(
            "confirmEmailChangeFailed",
            "We could not confirm your email change.",
          ),
      );
    }
  };

  const isMissingToken = !token;
  const isError = status === "error" || isMissingToken;

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
      <div className="w-full max-w-105 px-5">
        <div
          className="rounded-2xl p-8 text-center"
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
          }}
        >
          <div className="flex flex-col items-center pt-2 pb-6 border-b border-border/40 mb-6">
            <img
              src="/whale.webp"
              alt="Team9"
              className="w-14 h-14 mb-3 transition-transform duration-300 hover:scale-105"
              style={{
                filter:
                  "drop-shadow(0 4px 12px oklch(from var(--primary) l c h / 20%))",
              }}
            />
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Team9
            </h1>
          </div>

          {status === "success" ? (
            <>
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-xl font-semibold text-success mb-2">
                {t(
                  "confirmEmailChangeSuccess",
                  "Email address updated successfully.",
                )}
              </h2>
              <p className="text-muted-foreground mb-6">
                {t(
                  "confirmEmailChangeSuccessHint",
                  "Your login email has been updated. You can return to Team9 now.",
                )}
              </p>
            </>
          ) : isError ? (
            <>
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-5">
                <XCircle className="w-8 h-8 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-destructive mb-2">
                {t(
                  "confirmEmailChangeErrorTitle",
                  "Email change could not be confirmed",
                )}
              </h2>
              <p className="text-muted-foreground mb-6">
                {isMissingToken
                  ? t("invalidEmailChangeLink", "Invalid email change link")
                  : errorMessage}
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                {status === "submitting" ? (
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                ) : (
                  <MailCheck className="w-8 h-8 text-primary" />
                )}
              </div>
              <h2 className="text-xl font-semibold mb-2">
                {t("confirmEmailChangeTitle", "Confirm your new email address")}
              </h2>
              <p className="text-muted-foreground mb-6">
                {t(
                  "confirmEmailChangeHint",
                  "Click the button below to finish changing the email address for your Team9 account.",
                )}
              </p>
              <Button
                className="w-full rounded-xl h-11 font-semibold"
                onClick={handleConfirm}
                disabled={status === "submitting"}
              >
                {status === "submitting"
                  ? t("confirmingEmailChange", "Confirming...")
                  : t("confirmEmailChangeAction", "Confirm email change")}
              </Button>
            </>
          )}

          <Link to="/login" className="block mt-4">
            <Button variant="ghost" className="w-full rounded-xl h-11">
              {t("backToLogin", "Back to login")}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
