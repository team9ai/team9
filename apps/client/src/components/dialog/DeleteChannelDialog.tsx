import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle size={20} />
            Delete #{channel.name}
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. All messages in this channel will be
            permanently deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">
              <strong>Warning:</strong> Deleting this channel will:
            </p>
            <ul className="text-sm text-red-700 list-disc list-inside mt-2">
              <li>Remove all messages and files</li>
              <li>Remove all members from the channel</li>
              <li>This cannot be recovered</li>
            </ul>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              Type <span className="font-mono font-bold">{channel.name}</span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-name"
              value={confirmationName}
              onChange={(e) => setConfirmationName(e.target.value)}
              placeholder="Enter channel name"
              autoComplete="off"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="permanent"
              checked={isPermanent}
              onChange={(e) => setIsPermanent(e.target.checked)}
              className="rounded border-slate-300"
            />
            <Label htmlFor="permanent" className="text-sm font-normal">
              Permanently delete (cannot be recovered)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            disabled={!canDelete || deleteChannel.isPending}
            variant="destructive"
          >
            {deleteChannel.isPending ? "Deleting..." : "Delete Channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
