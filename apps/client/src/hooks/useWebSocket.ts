import { useEffect } from "react";
import wsService from "@/services/websocket";

/**
 * Hook to manage WebSocket connection lifecycle
 */
export function useWebSocket() {
  useEffect(() => {
    // Connect when component mounts
    wsService.connect();

    // Disconnect when component unmounts
    return () => {
      wsService.disconnect();
    };
  }, []);

  return wsService;
}
