import { useState, useEffect, useRef } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useVerifyEmail } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import workspaceApi from "@/services/api/workspace";
import { workspaceActions, appActions } from "@/stores";

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
  const verifiedRef = useRef(false);

  // Prevent token leakage via HTTP Referrer header
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage(t("invalidVerificationLink"));
      return;
    }

    // Prevent double execution in React StrictMode
    if (verifiedRef.current) return;
    verifiedRef.current = true;

    const verify = async () => {
      try {
        await verifyEmail.mutateAsync(token);
        setStatus("success");
        let joinedFromInvite = false;

        // Auto-accept pending invitation after successful verification
        const pendingInviteCode = localStorage.getItem("pending_invite_code");
        if (pendingInviteCode) {
          try {
            const result =
              await workspaceApi.acceptInvitation(pendingInviteCode);
            workspaceActions.setSelectedWorkspaceId(result.workspace.id);
            appActions.resetNavigationForWorkspaceEntry();
            joinedFromInvite = true;
          } catch {
            // Fail silently — user can revisit the invite link later
          } finally {
            localStorage.removeItem("pending_invite_code");
          }
        }

        // Try to wake up the desktop client via deep link.
        try {
          window.location.href = "team9://auth-complete";
        } catch {
          // Deep link not handled, continue in browser
        }

        // Redirect to home after 3 seconds
        setTimeout(() => {
          navigate({
            to: joinedFromInvite ? "/channels" : "/",
            replace: true,
          });
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

  // Inject keyframes if not already present
  useEffect(() => {
    const styleId = "login-keyframes";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `@keyframes loginFadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`;
      document.head.appendChild(style);
    }
  }, []);

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
        {/* Status Card */}
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
            animation: "loginFadeIn 0.5s ease-out 0.1s both",
          }}
        >
          {/* Logo */}
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
          {status === "loading" && (
            <>
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
              <h2 className="text-xl font-semibold">{t("verifyingEmail")}</h2>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-xl font-semibold text-success mb-2">
                {t("emailVerified")}
              </h2>
              <p className="text-muted-foreground mb-6">
                {t("emailVerifiedMessage")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("redirectingHome")}
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-5">
                <XCircle className="w-8 h-8 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-destructive mb-2">
                {t("verificationFailed")}
              </h2>
              <p className="text-muted-foreground mb-6">{errorMessage}</p>
              <Link to="/login" className="block">
                <Button className="w-full rounded-xl h-11 font-semibold">
                  {t("backToLogin")}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
