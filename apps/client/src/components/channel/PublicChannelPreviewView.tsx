import { Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { JoinChannelPrompt } from "./JoinChannelPrompt";
import type { PublicChannelPreview } from "@/types/im";

interface PublicChannelPreviewViewProps {
  channel: PublicChannelPreview;
}

export function PublicChannelPreviewView({
  channel,
}: PublicChannelPreviewViewProps) {
  const { t } = useTranslation("channel");

  return (
    <div className="h-full flex flex-col">
      {/* Simple header for non-members */}
      <div className="h-14 px-4 flex items-center border-b">
        <div className="flex items-center gap-2">
          <Hash size={20} className="text-muted-foreground" />
          <h2 className="font-semibold">{channel.name}</h2>
          <span className="text-sm text-muted-foreground">
            {t("members", { count: channel.memberCount })}
          </span>
        </div>
      </div>

      {/* Content area - show description or placeholder */}
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-8">
        <div className="max-w-md text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center mx-auto">
            <Hash size={32} className="text-gray-500" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900">
            # {channel.name}
          </h3>
          {channel.description && (
            <p className="text-muted-foreground">{channel.description}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Join this channel to see messages and participate in conversations.
          </p>
        </div>
      </div>

      {/* Join prompt at bottom */}
      <JoinChannelPrompt
        channelId={channel.id}
        channelName={channel.name || ""}
      />
    </div>
  );
}
