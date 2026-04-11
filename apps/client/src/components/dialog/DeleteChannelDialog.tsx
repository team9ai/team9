import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDeleteChannel } from "@/hooks/useChannels";
import type { Channel } from "@/types/im";

interface DeleteChannelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  channel: Channel;
  onDeleted?: () => void;
}

export function DeleteChannelDialog({
  isOpen,
  onClose,
  channel,
  onDeleted,
}: DeleteChannelDialogProps) {
  const { t } = useTranslation("channel");
  const navigate = useNavigate();
  const deleteChannel = useDeleteChannel();
  const [confirmationName, setConfirmationName] = useState("");
  const [isPermanent, setIsPermanent] = useState(false);

  const canDelete = confirmationName === channel.name;

  const handleDelete = async () => {
    if (!canDelete) return;

    try {
      await deleteChannel.mutateAsync({
        channelId: channel.id,
        data: {
          confirmationName,
          permanent: isPermanent,
        },
      });

      handleClose();
      onDeleted?.();

      navigate({ to: "/" });
    } catch (error) {
      console.error("Failed to delete channel:", error);
    }
  };

  const handleClose = () => {
    setConfirmationName("");
    setIsPermanent(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle size={20} />
            {t("deleteChannel")} #{channel.name}
          </DialogTitle>
          <DialogDescription>{t("deleteChannelDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">
              <strong>{t("common:warning")}</strong>{" "}
              {t("deleteChannelWarningTitle")}
            </p>
            <ul className="text-sm text-destructive list-disc list-inside mt-2">
              <li>{t("deleteWarningMessages")}</li>
              <li>{t("deleteWarningMembers")}</li>
              <li>{t("deleteWarningNoRecovery")}</li>
            </ul>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              {t("typeToConfirm", { name: channel.name })}
            </Label>
            <Input
              id="confirm-name"
              value={confirmationName}
              onChange={(e) => setConfirmationName(e.target.value)}
              placeholder={t("enterChannelName")}
              autoComplete="off"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="permanent"
              checked={isPermanent}
              onChange={(e) => setIsPermanent(e.target.checked)}
              className="rounded border-border"
            />
            <Label htmlFor="permanent" className="text-sm font-normal">
              {t("permanentDelete")}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose}>
            {t("common:cancel")}
          </Button>
          <Button
            onClick={handleDelete}
            disabled={!canDelete || deleteChannel.isPending}
            variant="destructive"
          >
            {deleteChannel.isPending ? t("deleting") : t("deleteChannel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
