import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, WifiOff } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import wsService, {
  type ConnectionStatus as WsConnectionStatus,
} from "@/services/websocket";
import { cn } from "@/lib/utils";

export function ConnectionStatus() {
  const { t } = useTranslation("common");
  const [status, setStatus] = useState<WsConnectionStatus>(
    wsService.connectionStatus,
  );

  useEffect(() => {
    const unsubscribe = wsService.onConnectionChange(setStatus);
    return () => unsubscribe();
  }, []);

  // Always reserve a fixed 7x7 slot so toggling this indicator doesn't
  // resize sibling elements (e.g. the global search bar).
  if (status === "connected") {
    return <div className="w-7 h-7 shrink-0" aria-hidden="true" />;
  }

  const isReconnecting = status === "reconnecting";
  const Icon = isReconnecting ? RefreshCw : WifiOff;
  const label = isReconnecting
    ? t("connection.reconnecting")
    : t("connection.disconnected");
  const hint = isReconnecting
    ? t("connection.reconnectingHint")
    : t("connection.disconnectedHint");

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex items-center justify-center w-7 h-7 rounded-md shrink-0 transition-colors cursor-pointer",
              isReconnecting
                ? "text-muted-foreground hover:bg-muted"
                : "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
            )}
          >
            <Icon className={cn("h-4 w-4", isReconnecting && "animate-spin")} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="max-w-xs">
          <div className="text-xs">
            <div className="font-medium">{label}</div>
            <div className="opacity-80 mt-0.5">{hint}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
