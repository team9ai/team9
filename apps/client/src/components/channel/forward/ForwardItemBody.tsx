import { useTranslation } from "react-i18next";
import type { ForwardItem } from "@/types/im";
import { UserAvatar } from "@/components/ui/user-avatar";
import { AstRenderer } from "../AstRenderer";

interface Props {
  item: ForwardItem;
  showJumpLink?: boolean;
  onJump?: (item: ForwardItem) => void;
}

export function ForwardItemBody({ item, showJumpLink = false, onJump }: Props) {
  const { t } = useTranslation("channel");

  const senderName =
    item.sourceSender?.displayName ?? item.sourceSender?.username ?? "?";

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium">
        <UserAvatar
          userId={item.sourceSender?.id ?? ""}
          name={item.sourceSender?.displayName ?? null}
          username={item.sourceSender?.username ?? ""}
          avatarUrl={item.sourceSender?.avatarUrl ?? null}
          className="h-5 w-5"
        />
        <span>{senderName}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(item.sourceCreatedAt).toLocaleString()}
        </span>
      </div>
      <div className="mt-1 text-sm">
        {item.contentAstSnapshot ? (
          <AstRenderer ast={item.contentAstSnapshot} />
        ) : (
          <span className="whitespace-pre-wrap">
            {item.contentSnapshot ?? ""}
          </span>
        )}
      </div>
      {item.attachmentsSnapshot.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {item.attachmentsSnapshot.map((a) => (
            <li key={a.originalAttachmentId}>
              <a
                href={a.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline"
              >
                {a.fileName}
              </a>
            </li>
          ))}
        </ul>
      )}
      {showJumpLink && item.canJumpToOriginal && item.sourceMessageId && (
        <button
          type="button"
          className="mt-2 text-xs text-primary underline"
          onClick={() => onJump?.(item)}
        >
          {t("forward.source.jumpTo")}
        </button>
      )}
    </div>
  );
}
