import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useJoinChannel } from "@/hooks/useChannels";
import { Loader2 } from "lucide-react";

interface JoinChannelPromptProps {
  channelId: string;
  channelName: string;
  onJoined?: () => void;
}

export function JoinChannelPrompt({
  channelId,
  channelName,
  onJoined,
}: JoinChannelPromptProps) {
  const { t } = useTranslation("channel");
  const joinChannel = useJoinChannel();

  const handleJoin = async () => {
    try {
      await joinChannel.mutateAsync(channelId);
      onJoined?.();
    } catch (error) {
      console.error("Failed to join channel:", error);
    }
  };

  return (
    <div className="border-t p-4 bg-background">
      <div className="flex flex-col items-center justify-center py-6 gap-4">
        <h3 className="text-lg font-semibold text-foreground">
          # {channelName}
        </h3>
        <Button
          onClick={handleJoin}
          disabled={joinChannel.isPending}
          className="bg-success hover:bg-success/90 text-primary-foreground px-8"
        >
          {joinChannel.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("joining")}
            </>
          ) : (
            t("joinChannel")
          )}
        </Button>
      </div>
    </div>
  );
}
