import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/services/api";
import { ForwardItemBody } from "./ForwardItemBody";
import type { ForwardItem } from "@/types/im";

interface Props {
  messageId: string;
  channelName: string | null;
  onOpenChange: (open: boolean) => void;
  onJump?: (item: ForwardItem) => void;
}

export function ForwardBundleViewer({
  messageId,
  channelName,
  onOpenChange,
  onJump,
}: Props) {
  const { t } = useTranslation("channel");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["forwardItems", messageId],
    queryFn: () => api.forward.getItems(messageId),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {channelName
              ? t("forward.bundle.modalTitle", { channelName })
              : t("forward.source.unavailable")}
          </DialogTitle>
        </DialogHeader>
        {isLoading && (
          <div className="p-4 text-sm text-muted-foreground">
            {t("forward.source.unavailable")}
          </div>
        )}
        {isError && (
          <div className="p-4 text-sm text-destructive">
            {t("forward.error.notFound")}
          </div>
        )}
        {data && (
          <ul className="max-h-[60vh] space-y-3 overflow-y-auto">
            {data.map((item) => (
              <li key={item.position} className="rounded border p-3">
                <ForwardItemBody item={item} showJumpLink onJump={onJump} />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
