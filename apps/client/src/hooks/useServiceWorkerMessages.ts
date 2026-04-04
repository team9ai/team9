import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

export function useServiceWorkerMessages() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "NOTIFICATION_CLICK" && event.data.actionUrl) {
        navigate({ to: event.data.actionUrl });
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, [navigate]);
}
