import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import type { Message, ForwardItem } from "@/types/im";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ForwardItemBody } from "./ForwardItemBody";
import { ForwardBundleViewer } from "./ForwardBundleViewer";

interface Props {
  message: Message;
}

export function ForwardedMessageCard({ message }: Props) {
  const { t } = useTranslation("channel");
  const navigate = useNavigate();
  const [bundleOpen, setBundleOpen] = useState(false);

  const fwd = message.forward;
  if (!fwd) return null;

  const headerText = fwd.sourceChannelName
    ? t("forward.card.fromChannel", { channelName: fwd.sourceChannelName })
    : t("forward.source.unavailable");

  const jumpToOriginal = (item: ForwardItem) => {
    if (!item.sourceMessageId) return;
    void navigate({
      to: "/channels/$channelId",
      params: { channelId: item.sourceChannelId },
      search: { message: item.sourceMessageId },
    });
  };

  if (fwd.kind === "single") {
    const item = fwd.items[0];
    if (!item) return null;
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{headerText}</div>
        <div className="rounded border-l-4 border-muted-foreground/30 bg-muted/30 p-3">
          <ForwardItemBody item={item} showJumpLink onJump={jumpToOriginal} />
        </div>
      </div>
    );
  }

  // bundle
  const previews = fwd.items.slice(0, 3);
  return (
    <>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">{headerText}</div>
        <button
          type="button"
          onClick={() => setBundleOpen(true)}
          className="block w-full rounded border bg-muted/30 p-3 text-left hover:bg-muted/50"
        >
          <div className="text-sm font-medium">
            {t("forward.bundle.title", { count: fwd.count })}
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {previews.map((it) => (
              <li key={it.position} className="flex items-center gap-2">
                <UserAvatar
                  userId={it.sourceSender?.id ?? ""}
                  name={it.sourceSender?.displayName ?? null}
                  username={it.sourceSender?.username ?? ""}
                  avatarUrl={it.sourceSender?.avatarUrl ?? null}
                  className="h-5 w-5"
                />
                <span className="font-medium">
                  {it.sourceSender?.displayName ??
                    it.sourceSender?.username ??
                    "?"}
                </span>
                <span className="line-clamp-1 text-muted-foreground">
                  {it.contentSnapshot?.slice(0, 80) ?? ""}
                </span>
              </li>
            ))}
          </ul>
          {fwd.count > previews.length && (
            <div className="mt-2 text-xs text-muted-foreground">
              {t("forward.bundle.viewAll")}
            </div>
          )}
        </button>
      </div>
      {bundleOpen && (
        <ForwardBundleViewer
          messageId={message.id}
          channelName={fwd.sourceChannelName}
          onOpenChange={setBundleOpen}
          onJump={jumpToOriginal}
        />
      )}
    </>
  );
}
