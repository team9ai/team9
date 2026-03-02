import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import wsService, {
  type ConnectionStatus as WsConnectionStatus,
} from "@/services/websocket";

export function ConnectionStatus() {
  const [status, setStatus] = useState<WsConnectionStatus>(
    wsService.connectionStatus,
  );
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout>;

    const unsubscribe = wsService.onConnectionChange((newStatus) => {
      setStatus((prev) => {
        // Show brief "reconnected" toast when recovering from disconnection
        if (
          (prev === "disconnected" || prev === "reconnecting") &&
          newStatus === "connected"
        ) {
          setShowReconnected(true);
          hideTimer = setTimeout(() => setShowReconnected(false), 2000);
        }
        return newStatus;
      });
    });

    return () => {
      unsubscribe();
      clearTimeout(hideTimer);
    };
  }, []);

  if (status === "connected" && !showReconnected) return null;

  // if (showReconnected) {
  //   return (
  //     <div className="bg-green-500/90 text-white text-xs text-center py-1 px-3">
  //       Connection restored
  //     </div>
  //   );
  // }

  return (
    <div className="bg-yellow-500/90 text-white text-xs text-center py-1 px-3 flex items-center justify-center gap-1.5">
      <WifiOff className="h-3 w-3" />
      <span>Reconnecting…</span>
    </div>
  );
}
