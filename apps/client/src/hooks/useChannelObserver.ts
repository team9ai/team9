import { useEffect, useRef } from "react";
import wsService from "@/services/websocket";

/**
 * Hook to temporarily observe a channel's events via WebSocket.
 * Per-connection subscription — automatically re-subscribes on reconnect.
 * Pass null/undefined channelId to unsubscribe.
 */
export function useChannelObserver(channelId: string | null | undefined) {
  const observedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!channelId) {
      // Unobserve previous if any
      if (observedRef.current) {
        wsService.unobserveChannel(observedRef.current);
        observedRef.current = null;
      }
      return;
    }

    // Observe the new channel
    wsService.observeChannel(channelId);
    observedRef.current = channelId;

    // Re-subscribe on reconnect
    const handleReconnect = () => {
      if (observedRef.current) {
        wsService.observeChannel(observedRef.current);
      }
    };
    wsService.on("connect", handleReconnect);

    return () => {
      // Cleanup: unobserve and remove reconnect handler
      if (observedRef.current) {
        wsService.unobserveChannel(observedRef.current);
        observedRef.current = null;
      }
      wsService.off("connect", handleReconnect);
    };
  }, [channelId]);
}
