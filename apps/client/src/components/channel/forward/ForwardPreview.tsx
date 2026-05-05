import { useTranslation } from "react-i18next";
import type { Message } from "@/types/im";
import { UserAvatar } from "@/components/ui/user-avatar";

interface Props {
  messages: Message[];
}

export function ForwardPreview({ messages }: Props) {
  const { t } = useTranslation("channel");

  if (messages.length === 1) {
    const m = messages[0];
    return (
      <div className="rounded border-l-4 border-muted-foreground/30 bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <UserAvatar
            userId={m.sender?.id}
            name={m.sender?.displayName ?? null}
            username={m.sender?.username}
            avatarUrl={m.sender?.avatarUrl ?? null}
            isBot={m.sender?.userType === "bot"}
            className="h-5 w-5"
          />
          <span>{m.sender?.displayName ?? m.sender?.username ?? ""}</span>
        </div>
        <div className="mt-1 line-clamp-3 text-sm text-muted-foreground">
          {m.content}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border bg-muted/30 p-3">
      <div className="text-sm font-medium">
        {t("forward.bundle.title", { count: messages.length })}
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {messages.slice(0, 3).map((m) => (
          <li key={m.id} className="flex items-center gap-2">
            <UserAvatar
              userId={m.sender?.id}
              name={m.sender?.displayName ?? null}
              username={m.sender?.username}
              avatarUrl={m.sender?.avatarUrl ?? null}
              isBot={m.sender?.userType === "bot"}
              className="h-5 w-5"
            />
            <span className="font-medium">
              {m.sender?.displayName ?? m.sender?.username ?? ""}
            </span>
            <span className="line-clamp-1 text-muted-foreground">
              {m.content?.slice(0, 80) ?? ""}
            </span>
          </li>
        ))}
        {messages.length > 3 && (
          <li className="text-xs text-muted-foreground">
            …{t("forward.bundle.viewAll")}
          </li>
        )}
      </ul>
    </div>
  );
}
