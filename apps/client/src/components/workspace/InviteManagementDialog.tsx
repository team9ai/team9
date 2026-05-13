import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UserPlus } from "lucide-react";
import { useWorkspaceInviteLink } from "@/hooks/useWorkspaceInviteLink";
import { useTranslation } from "react-i18next";

interface InviteManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
}

export function InviteManagementDialog({
  isOpen,
  onClose,
  workspaceId,
}: InviteManagementDialogProps) {
  const { t } = useTranslation(["navigation", "common"]);
  const [copied, setCopied] = useState(false);

  const { url: inviteUrl } = useWorkspaceInviteLink(workspaceId, isOpen);

  const handleCopyLink = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md p-0 border-0 bg-transparent shadow-none">
        <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex flex-col h-full">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                <UserPlus size={16} className="text-success" />
              </div>
              <h3 className="font-semibold text-base">{t("inviteFriends")}</h3>
            </div>
            <div className="bg-muted rounded-lg px-4 py-2.5 mb-4">
              <span className="text-sm font-mono text-foreground break-all block">
                {inviteUrl ?? t("common:loading")}
              </span>
            </div>
            <div className="mt-auto text-center">
              <Button
                size="sm"
                className="bg-info hover:bg-info/90 text-primary-foreground rounded-lg px-6 cursor-pointer"
                disabled={!inviteUrl}
                onClick={handleCopyLink}
              >
                {copied ? t("navigation:copied") : t("navigation:copyLink")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
