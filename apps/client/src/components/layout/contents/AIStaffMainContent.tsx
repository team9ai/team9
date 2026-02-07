import { Bot, Loader2, AlertCircle, User, Plus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { api } from "@/services/api";
import type {
  InstalledApplication,
  OpenClawBotInfo,
  OpenClawInstanceStatus,
} from "@/services/api/applications";
import { cn } from "@/lib/utils";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";

// ── Per-bot card ─────────────────────────────────────────────────────

interface AIStaffBotCardProps {
  app: InstalledApplication;
  bot: OpenClawBotInfo;
  instanceStatus?: OpenClawInstanceStatus;
}

function AIStaffBotCard({ app, bot, instanceStatus }: AIStaffBotCardProps) {
  const navigate = useNavigate();

  const displayName = bot.displayName || app.name || "AI Staff";
  const isRunning = instanceStatus?.status === "running";
  const initials = displayName.slice(0, 2).toUpperCase();
  const isDefault = !bot.agentId;

  return (
    <Card
      onClick={() =>
        navigate({
          to: "/ai-staff/$staffId",
          params: { staffId: bot.botId },
        })
      }
      className="p-4 cursor-pointer hover:shadow-md transition-all"
    >
      <div className="flex items-center gap-4">
        {/* Avatar with status indicator */}
        <div className="relative">
          <Avatar className="w-12 h-12">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-background",
              isRunning ? "bg-success" : "bg-muted-foreground",
            )}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground truncate">
              {displayName}
            </p>
            <Badge
              variant={isDefault ? "default" : "secondary"}
              className="shrink-0 text-[10px] px-1.5 py-0"
            >
              {isDefault ? "Default" : "Agent"}
            </Badge>
          </div>
          {bot.username && (
            <p className="text-xs text-muted-foreground truncate">
              @{bot.username}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {app.name}
            {instanceStatus && (
              <span
                className={cn(
                  "ml-2",
                  isRunning ? "text-success" : "text-muted-foreground",
                )}
              >
                {instanceStatus.status}
              </span>
            )}
          </p>
          {bot.mentorDisplayName && (
            <div className="flex items-center gap-1 mt-1">
              <Avatar className="w-4 h-4">
                {bot.mentorAvatarUrl ? (
                  <AvatarImage src={bot.mentorAvatarUrl} />
                ) : (
                  <AvatarFallback className="bg-muted text-muted-foreground text-[8px]">
                    <User size={10} />
                  </AvatarFallback>
                )}
              </Avatar>
              <span className="text-xs text-muted-foreground truncate">
                {bot.mentorDisplayName}
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Bot cards for a single app ───────────────────────────────────────

function AppBotCards({ app }: { app: InstalledApplication }) {
  const workspaceId = useSelectedWorkspaceId();

  const { data: bots } = useQuery({
    queryKey: ["openclaw-bots", workspaceId, app.id],
    queryFn: () => api.applications.getOpenClawBots(app.id),
    enabled: app.applicationId === "openclaw" && app.status === "active",
  });

  const { data: instanceStatus } = useQuery({
    queryKey: ["openclaw-status", workspaceId, app.id],
    queryFn: () => api.applications.getOpenClawStatus(app.id),
    enabled: app.applicationId === "openclaw" && app.status === "active",
  });

  if (!bots) return null;

  return (
    <>
      {bots.map((bot) => (
        <AIStaffBotCard
          key={bot.botId}
          app={app}
          bot={bot}
          instanceStatus={instanceStatus}
        />
      ))}
    </>
  );
}

// ── Create Agent Dialog ──────────────────────────────────────────────

interface CreateAgentDialogProps {
  openClawApps: InstalledApplication[];
  workspaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateAgentDialog({
  openClawApps,
  workspaceId,
  open,
  onOpenChange,
}: CreateAgentDialogProps) {
  const queryClient = useQueryClient();
  const [selectedAppId, setSelectedAppId] = useState(
    openClawApps.length === 1 ? openClawApps[0].id : "",
  );
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      api.applications.createOpenClawAgent(selectedAppId, {
        displayName: displayName.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["openclaw-bots", workspaceId, selectedAppId],
      });
      setDisplayName("");
      setDescription("");
      onOpenChange(false);
    },
  });

  const canSubmit =
    !!selectedAppId && !!displayName.trim() && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Agent</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">OpenClaw Instance</label>
            <Select value={selectedAppId} onValueChange={setSelectedAppId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select instance..." />
              </SelectTrigger>
              <SelectContent>
                {openClawApps.map((app) => (
                  <SelectItem key={app.id} value={app.id}>
                    {app.name || app.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Agent name..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  createMutation.mutate();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Description{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {createMutation.isPending ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Plus size={14} className="mr-1" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function AIStaffMainContent() {
  const { t } = useTranslation("navigation");
  const workspaceId = useSelectedWorkspaceId();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const {
    data: installedApps,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["installed-applications", workspaceId],
    queryFn: () => api.applications.getInstalledApplications(),
    enabled: !!workspaceId,
  });

  const openClawApps =
    installedApps?.filter(
      (a) => a.applicationId === "openclaw" && a.status === "active",
    ) ?? [];

  return (
    <main className="flex-1 flex flex-col bg-background">
      {/* Content Header */}
      <header className="h-14 bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-primary" />
          <h2 className="font-semibold text-lg text-foreground">
            {t("aiStaff")}
          </h2>
        </div>
        {openClawApps.length > 0 && (
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <Plus size={14} className="mr-1" />
            Create Agent
          </Button>
        )}
      </header>

      <Separator />

      {/* Content */}
      <ScrollArea className="flex-1 bg-secondary/50">
        <div className="p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <Card className="p-6 text-center">
              <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Failed to load AI Staff
              </p>
            </Card>
          )}

          {!isLoading &&
            !error &&
            installedApps &&
            installedApps.length === 0 && (
              <Card className="p-6 text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
                  <Bot size={32} className="text-primary" />
                </div>
                <h3 className="font-medium text-foreground mb-1">
                  {t("createFirstAIStaff")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("aiStaffDescription")}
                </p>
              </Card>
            )}

          {!isLoading &&
            !error &&
            installedApps &&
            installedApps.length > 0 && (
              <div className="max-w-md space-y-2">
                {installedApps.map((app) => (
                  <AppBotCards key={app.id} app={app} />
                ))}
              </div>
            )}
        </div>
      </ScrollArea>

      {openClawApps.length > 0 && (
        <CreateAgentDialog
          openClawApps={openClawApps}
          workspaceId={workspaceId}
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
        />
      )}
    </main>
  );
}
