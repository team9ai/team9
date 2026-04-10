import { useState } from "react";
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
}

export function AgenticAgentPicker({ open, onClose }: AgenticAgentPickerProps) {
  const { t } = useTranslation("routines");
  const navigate = useNavigate();
  const workspaceId = useSelectedWorkspaceId();

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { data: allBots = [], isLoading: botsLoading } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId],
    queryFn: async () => {
      const apps = await api.applications.getInstalledApplicationsWithBots();
      return apps.filter((a) => a.status === "active").flatMap((a) => a.bots);
    },
    enabled: open && !!workspaceId,
  });

  // Default to personal staff if available (first bot with no agentId = personal staff)
  const defaultBotId =
    allBots.find((b) => "agentId" in b && b.agentId === null)?.botId ??
    allBots[0]?.botId ??
    "";

  const effectiveAgentId = selectedAgentId || defaultBotId;

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
      setError((err as Error)?.message ?? t("agentic.errorGeneric", "Failed to start creation"));
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
          <DialogTitle>{t("agentic.pickerTitle")}</DialogTitle>
          <DialogDescription>{t("agentic.pickerDescription")}</DialogDescription>
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
                  {allBots.map((bot) => (
                    <SelectItem key={bot.botId} value={bot.botId}>
                      {"displayName" in bot && bot.displayName
                        ? bot.displayName
                        : bot.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={createMutation.isPending}>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
