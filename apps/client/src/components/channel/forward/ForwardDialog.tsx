import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import { ForwardChannelList } from "./ForwardChannelList";
import { ForwardPreview } from "./ForwardPreview";
import type { Message } from "@/types/im";

const ERROR_TO_KEY: Record<string, string> = {
  "forward.tooManySelected": "forward.tooManySelected",
  "forward.mixedChannels": "forward.error.mixedChannels",
  "forward.noWriteAccess": "forward.error.noWriteAccess",
  "forward.noSourceAccess": "forward.error.noSourceAccess",
  "forward.notAllowed": "forward.error.notAllowed",
  "forward.notFound": "forward.error.notFound",
  "forward.empty": "forward.error.empty",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceChannelId: string;
  sourceMessages: Message[];
  onSuccess?: () => void;
}

export function ForwardDialog({
  open,
  onOpenChange,
  sourceChannelId,
  sourceMessages,
  onSuccess,
}: Props) {
  const { t } = useTranslation("channel");
  const queryClient = useQueryClient();
  const [targetChannelId, setTargetChannelId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (channelId: string) => {
      return api.forward.create({
        targetChannelId: channelId,
        sourceChannelId,
        sourceMessageIds: sourceMessages.map((m) => m.id),
      });
    },
    onSuccess: (_data, channelId) => {
      toast(t("forward.success"));
      queryClient.invalidateQueries({
        queryKey: ["channelMessages", channelId],
      });
      setTargetChannelId(null);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err: unknown) => {
      const code = extractErrorCode(err);
      const key = ERROR_TO_KEY[code] ?? "forward.error.notAllowed";
      toast.error(t(key as never));
    },
  });

  const title =
    sourceMessages.length === 1
      ? t("forward.dialog.titleSingle")
      : t("forward.dialog.titleBundle", { count: sourceMessages.length });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <ForwardChannelList
            excludeChannelId={sourceChannelId}
            selectedChannelId={targetChannelId}
            onSelect={setTargetChannelId}
          />
          <ForwardPreview messages={sourceMessages} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("forward.dialog.cancel")}
          </Button>
          <Button
            disabled={!targetChannelId || mutation.isPending}
            onClick={() => targetChannelId && mutation.mutate(targetChannelId)}
          >
            {t("forward.dialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function extractErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    // The custom HttpClient surfaces server error body via error.response.data
    // NestJS returns { statusCode, message, error } for BadRequestException
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    if (e.response?.data?.message) return e.response.data.message;
    if (typeof e.message === "string") return e.message;
  }
  return "";
}
