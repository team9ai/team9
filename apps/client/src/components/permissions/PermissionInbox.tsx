import { useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/useAppStore";
import {
  usePendingPermissionRequests,
  useDecidePermission,
} from "@/hooks/usePermissions";
import {
  PermissionRequestCard,
  type DecideInput,
} from "./PermissionRequestCard";

export function PermissionInbox() {
  const { t } = useTranslation("permissions");
  const [open, setOpen] = useState(false);
  const count = useAppStore((s) => s.pendingPermissionCount);
  const { data = [] } = usePendingPermissionRequests();
  const decide = useDecidePermission();

  const onDecide = (id: string) => (input: DecideInput) =>
    decide.mutate({ requestId: id, ...input });

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("inbox.badgeAria", { count })}
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 h-7 w-7 flex items-center justify-center text-nav-foreground-subtle hover:text-nav-foreground hover:bg-nav-hover rounded"
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 text-[10px] bg-destructive text-destructive-foreground rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-96 rounded-md border bg-popover shadow-lg p-3 z-50">
          <h3 className="font-medium mb-2 text-sm">{t("inbox.title")}</h3>
          {data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("inbox.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {data.map((req) => (
                <li key={req.id}>
                  <PermissionRequestCard
                    request={{
                      ...req,
                      requesterBotName: req.requesterBotId,
                    }}
                    onDecide={onDecide(req.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
