import { useCallback, useState } from "react";
import type { ChannelTab } from "@/types/properties";

interface JumpState {
  id: string;
  seq: number;
}

export interface UseMessageJumpResult {
  jumpToMessage: (messageId: string) => void;
  highlightId: string | undefined;
  seq: number;
}

export function useMessageJump(
  channelTabs: ChannelTab[],
  setActiveTabId: (tabId: string) => void,
): UseMessageJumpResult {
  const [state, setState] = useState<JumpState | undefined>(undefined);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      const messagesTab = channelTabs.find((t) => t.type === "messages");
      if (!messagesTab) return;
      setActiveTabId(messagesTab.id);
      setState((prev) => ({ id: messageId, seq: (prev?.seq ?? 0) + 1 }));
    },
    [channelTabs, setActiveTabId],
  );

  return {
    jumpToMessage,
    highlightId: state?.id,
    seq: state?.seq ?? 0,
  };
}
