import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import type { OpenClawBotInfo } from "@/services/api/applications";

interface CreateTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const NO_BOT = "__none__";

export function CreateTaskDialog({ isOpen, onClose }: CreateTaskDialogProps) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  const [title, setTitle] = useState("");
  const [botId, setBotId] = useState<string>(NO_BOT);
  const [documentContent, setDocumentContent] = useState("");

  // Fetch all installed apps, then bots from active OpenClaw apps
  const { data: installedApps } = useQuery({
    queryKey: ["installed-applications", workspaceId],
    queryFn: () => api.applications.getInstalledApplications(),
    enabled: isOpen && !!workspaceId,
  });

  const openClawApps =
    installedApps?.filter(
      (a) => a.applicationId === "openclaw" && a.status === "active",
    ) ?? [];

  const { data: allBots = [] } = useQuery({
    queryKey: ["openclaw-bots-all", workspaceId, openClawApps.map((a) => a.id)],
    queryFn: async () => {
      const results = await Promise.all(
        openClawApps.map((app) => api.applications.getOpenClawBots(app.id)),
      );
      return results.flat();
    },
    enabled: isOpen && openClawApps.length > 0,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.tasks.create({
        title: title.trim(),
        botId: botId === NO_BOT ? undefined : botId,
        documentContent: documentContent.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      handleClose();
    },
  });

  function handleClose() {
    setTitle("");
    setBotId(NO_BOT);
    setDocumentContent("");
    createMutation.reset();
    onClose();
  }

  const canSubmit = title.trim().length > 0 && !createMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="task-title">{t("create.taskName")}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={500}
              placeholder={t("create.taskNamePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  createMutation.mutate();
                }
              }}
              autoFocus
            />
          </div>

          {/* Bot select */}
          <div className="space-y-1.5">
            <Label>{t("create.bot")}</Label>
            <Select value={botId} onValueChange={setBotId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("create.botPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BOT}>
                  <span className="text-muted-foreground">
                    {t("create.noBot")}
                  </span>
                </SelectItem>
                {allBots.map((bot: OpenClawBotInfo) => (
                  <SelectItem key={bot.botId} value={bot.botId}>
                    {bot.displayName || bot.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Document content */}
          <div className="space-y-1.5">
            <Label htmlFor="task-doc">{t("create.document")}</Label>
            <Textarea
              id="task-doc"
              value={documentContent}
              onChange={(e) => setDocumentContent(e.target.value)}
              placeholder={t("create.documentPlaceholder")}
              rows={4}
              className="resize-none"
            />
          </div>

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {(createMutation.error as Error)?.message ||
                t("create.errorGeneric")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            {t("create.cancel")}
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {createMutation.isPending && (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            )}
            {t("create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
