import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createWeixinQrImageSrc,
  externalImGatewayApi,
  type WeixinIlinkConnection,
  type WeixinIlinkLoginSession,
  type WeixinIlinkLoginStatus,
} from "@/services/api/external-im-gateway";

function getGatewayErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "data" in error.response &&
    error.response.data &&
    typeof error.response.data === "object" &&
    "message" in error.response.data &&
    typeof error.response.data.message === "string"
  ) {
    return error.response.data.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "";
}

function formatExpiresAt(expiresAt: string | undefined) {
  if (!expiresAt) return null;

  const time = Date.parse(expiresAt);
  if (Number.isNaN(time)) return null;

  return new Date(time).toLocaleTimeString();
}

export function useWeixinIlinkConnection({
  enabled = true,
  team9TenantId,
  team9UserId,
}: {
  enabled?: boolean;
  team9TenantId?: string | null;
  team9UserId?: string;
}) {
  const { t } = useTranslation("settings");
  const [loginSession, setLoginSession] =
    useState<WeixinIlinkLoginSession | null>(null);
  const [loginStatus, setLoginStatus] = useState<WeixinIlinkLoginStatus | null>(
    null,
  );
  const [connection, setConnection] = useState<WeixinIlinkConnection | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [qrImageSrc, setQrImageSrc] = useState<string | null>(null);
  const [isStartingLogin, setIsStartingLogin] = useState(false);

  const errorMessageFor = useCallback(
    (rawError: unknown) => {
      const message = getGatewayErrorMessage(rawError);
      if (message.includes("Failed to fetch")) {
        return t(
          "weixinCard.gatewayUnavailable",
          "Weixin gateway is not reachable. Start team9-external-im-gateway and try again.",
        );
      }

      return (
        message ||
        t(
          "weixinCard.loginFailed",
          "We could not start Weixin login right now.",
        )
      );
    },
    [t],
  );

  useEffect(() => {
    if (enabled) return;

    setLoginSession(null);
    setLoginStatus(null);
    setError(null);
    setQrImageSrc(null);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !team9UserId) {
      setConnection(null);
      return;
    }

    let cancelled = false;
    void externalImGatewayApi
      .listWeixinIlinkConnections()
      .then((connections) => {
        if (cancelled) return;

        const matchedConnection = connections.find(
          (item) =>
            item.team9UserId === team9UserId &&
            (!team9TenantId || item.team9TenantId === team9TenantId),
        );
        setConnection(matchedConnection ?? null);
      })
      .catch(() => {
        // The local external IM gateway is optional until the user connects.
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, team9TenantId, team9UserId]);

  useEffect(() => {
    if (!enabled || !loginSession) {
      setQrImageSrc(null);
      return;
    }

    let cancelled = false;
    void createWeixinQrImageSrc(loginSession.qrcodeUrl)
      .then((imageSrc) => {
        if (!cancelled) setQrImageSrc(imageSrc);
      })
      .catch(() => {
        if (!cancelled) {
          setQrImageSrc(null);
          setError(
            t(
              "weixinCard.qrRenderFailed",
              "We could not render this Weixin QR code.",
            ),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, loginSession, t]);

  useEffect(() => {
    if (!enabled || !loginSession) return;

    let cancelled = false;
    const pollStatus = async () => {
      try {
        const result = await externalImGatewayApi.getWeixinIlinkLoginStatus(
          loginSession.sessionKey,
        );
        if (cancelled) return;

        setLoginStatus(result.status);

        if (result.connected && result.connection) {
          setConnection(result.connection);
          setLoginSession(null);
          setError(null);
          return;
        }

        if (result.connected) {
          setLoginSession(null);
          setError(
            result.message ??
              t(
                "weixinCard.loginFailed",
                "We could not start Weixin login right now.",
              ),
          );
          return;
        }

        if (result.status === "expired" || result.alreadyConnected) {
          setLoginSession(null);
          setError(
            result.message ??
              t(
                "weixinCard.loginExpired",
                "This Weixin login session can no longer be used.",
              ),
          );
        }
      } catch (pollError) {
        if (cancelled) return;
        setLoginSession(null);
        setError(errorMessageFor(pollError));
      }
    };

    void pollStatus();
    const intervalId = window.setInterval(() => void pollStatus(), 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled, errorMessageFor, loginSession, t]);

  const startLogin = useCallback(async () => {
    if (!team9UserId || isStartingLogin) return;

    try {
      setIsStartingLogin(true);
      setError(null);
      setConnection(null);
      const session = await externalImGatewayApi.startWeixinIlinkLogin({
        team9UserId,
        team9TenantId: team9TenantId ?? undefined,
        force: true,
      });
      setLoginSession(session);
      setLoginStatus(session.status);
    } catch (loginError) {
      setError(errorMessageFor(loginError));
    } finally {
      setIsStartingLogin(false);
    }
  }, [errorMessageFor, isStartingLogin, team9TenantId, team9UserId]);

  const statusLabel = useMemo(() => {
    switch (loginStatus) {
      case "wait":
        return t("weixinCard.status.wait", "Waiting for scan");
      case "scaned":
      case "scaned_but_redirect":
        return t("weixinCard.status.scanned", "Scanned, waiting for confirm");
      case "confirmed":
        return t("weixinCard.status.confirmed", "Connected");
      case "binded_redirect":
        return t("weixinCard.status.alreadyBound", "Already bound in iLink");
      case "expired":
        return t("weixinCard.status.expired", "QR code expired");
      default:
        return t("weixinCard.status.idle", "Not connected");
    }
  }, [loginStatus, t]);

  return {
    canStartLogin: Boolean(team9UserId && team9TenantId && !isStartingLogin),
    connection,
    error,
    expiresAtTime: formatExpiresAt(loginSession?.expiresAt),
    isStartingLogin,
    loginSession,
    qrImageSrc,
    startLogin,
    statusLabel,
  };
}
