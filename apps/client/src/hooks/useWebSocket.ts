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

/**
 * Hook to automatically join/leave a channel
 */
export function useChannel(channelId: string | undefined) {
  useEffect(() => {
    if (!channelId) return;

    console.log("[useChannel] Joining channel:", channelId);
    wsService.joinChannel(channelId);

    return () => {
      console.log("[useChannel] Leaving channel:", channelId);
      wsService.leaveChannel(channelId);
    };
  }, [channelId]);
}
