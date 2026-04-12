import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger as SelectTriggerUI,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";

interface AgenticAgentPickerProps {
  open: boolean;
  onClose: () => void;
  onManualCreate?: () => void;
}

export function AgenticAgentPicker({
  open,
  onClose,
  onManualCreate,
}: AgenticAgentPickerProps) {
  const { t } = useTranslation("routines");
  const navigate = useNavigate();
  const workspaceId = useSelectedWorkspaceId();

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { data: allBots = [], isLoading: botsLoading } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId],
    queryFn: async () => {
      const apps = await api.applications.getInstalledApplicationsWithBots();
      return apps
        .filter((a) => a.status === "active")
        .flatMap((a) => a.bots)
        .filter((b) => !("agentType" in b && b.agentType === "openclaw"));
    },
    enabled: open && !!workspaceId,
  });

  // Auto-select the first bot when data loads (or personal staff if available)
  useEffect(() => {
    if (allBots.length > 0 && !selectedAgentId) {
      const personalStaff = allBots.find(
        (b) => "agentId" in b && b.agentId === null,
      );
      setSelectedAgentId(personalStaff?.botId ?? allBots[0].botId);
    }
  }, [allBots, selectedAgentId]);

  const effectiveAgentId = selectedAgentId;

  const createMutation = useMutation({
    mutationFn: () =>
      api.routines.createWithCreationTask({ agentId: effectiveAgentId }),
    onSuccess: (data) => {
      handleClose();
      void navigate({
        to: "/messages/$channelId",
        params: { channelId: data.creationChannelId },
      });
    },
    onError: (err) => {
      setError(
        (err as Error)?.message ??
          t("agentic.errorGeneric", "Failed to start creation"),
      );
    },
  });

  function handleClose() {
    setSelectedAgentId("");
    setError(null);
    createMutation.reset();
    onClose();
  }

  const canConfirm = !createMutation.isPending && allBots.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-4">
          <div className="space-y-1.5">
            <Label>{t("agentic.agentLabel")}</Label>
            {botsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : allBots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("agentic.noAgentsAvailable")}
              </p>
            ) : (
              <Select
                value={effectiveAgentId}
                onValueChange={setSelectedAgentId}
              >
                <SelectTriggerUI className="w-full">
                  <SelectValue />
                </SelectTriggerUI>
                <SelectContent>
                  {allBots
                    .filter((bot) => bot.botId)
                    .map((bot) => (
                      <SelectItem key={bot.botId} value={bot.botId}>
                        {("displayName" in bot && bot.displayName) ||
                          ("username" in bot && bot.username) ||
                          bot.botId}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col">
          {onManualCreate && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
              onClick={onManualCreate}
            >
              {t("createManually")}
            </button>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={createMutation.isPending}
            >
              {t("agentic.cancel")}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canConfirm}
            >
              {createMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              )}
              {createMutation.isPending
                ? t("agentic.navigatingToast")
                : t("agentic.confirm")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
