import {
  ArrowLeft,
  Bot,
  Play,
  Square,
  RotateCw,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
  Pencil,
  User,
  Trash2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { WorkspaceFileBrowserContent } from "./WorkspaceFileBrowserContent";
import type { WorkspaceMember } from "@/types/workspace";

function statusBadgeVariant(status?: string) {
  switch (status) {
    case "running":
      return "default" as const;
    case "stopped":
      return "secondary" as const;
    case "error":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString();
}

// ── Main Component ──────────────────────────────────────────────────
// staffId is a botId — we resolve the installed app from the bot list.

interface AIStaffDetailContentProps {
  staffId: string; // botId
}

export function AIStaffDetailContent({ staffId }: AIStaffDetailContentProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation("navigation");
  const workspaceId = useSelectedWorkspaceId();
  const [copiedId, setCopiedId] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descInput, setDescInput] = useState("");

  // 1. Get all installed apps → find the OpenClaw app
  const { data: installedApps, isLoading: appsLoading } = useQuery({
    queryKey: ["installed-applications", workspaceId],
    queryFn: () => api.applications.getInstalledApplications(),
    enabled: !!workspaceId,
  });

  const openClawApp = installedApps?.find(
    (a) => a.applicationId === "openclaw" && a.status === "active",
  );
  const appId = openClawApp?.id;

  // 2. Get bots for this app → find the current bot by staffId (botId)
  const { data: bots, isLoading: botsLoading } = useQuery({
    queryKey: ["openclaw-bots", workspaceId, appId],
    queryFn: () => api.applications.getOpenClawBots(appId!),
    enabled: !!appId,
  });

  const currentBot = bots?.find((b) => b.botId === staffId);
  const isDefault = !currentBot?.agentId;

  // 3. Instance status (app-level)
  const { data: instanceStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["openclaw-status", workspaceId, appId],
    queryFn: () => api.applications.getOpenClawStatus(appId!),
    enabled: !!appId,
    refetchInterval: 10000,
  });

  // Mutations (all use appId, not staffId)
  const startMutation = useMutation({
    mutationFn: () => api.applications.openClawAction(appId!, "start"),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["openclaw-status", workspaceId, appId],
      }),
  });

  const stopMutation = useMutation({
    mutationFn: () => api.applications.openClawAction(appId!, "stop"),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["openclaw-status", workspaceId, appId],
      }),
  });

  const restartMutation = useMutation({
    mutationFn: () => api.applications.openClawAction(appId!, "restart"),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["openclaw-status", workspaceId, appId],
      }),
  });

  const renameBotMutation = useMutation({
    mutationFn: (displayName: string) => {
      if (!currentBot?.botId || !appId) throw new Error("No bot to rename");
      return api.applications.updateOpenClawBot(appId, currentBot.botId, {
        displayName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["openclaw-bots", workspaceId, appId],
      });
      setEditingName(false);
    },
  });

  const updateDescMutation = useMutation({
    mutationFn: (description: string) => {
      if (!appId) throw new Error("No app");
      return api.applications.updateInstalledApplication(appId, {
        description,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["installed-applications", workspaceId],
      });
      setEditingDesc(false);
    },
  });

  const mentorMutation = useMutation({
    mutationFn: (mentorId: string | null) => {
      if (!currentBot?.botId || !appId) throw new Error("No bot");
      return api.applications.updateOpenClawBotMentor(
        appId,
        currentBot.botId,
        mentorId,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["openclaw-bots", workspaceId, appId],
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!currentBot?.botId || !appId) throw new Error("No bot");
      return api.applications.deleteOpenClawAgent(appId, currentBot.botId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["openclaw-bots", workspaceId, appId],
      });
      navigate({ to: "/ai-staff" });
    },
  });

  // Fetch workspace members for mentor selector (human users only)
  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => api.workspace.getMembers(workspaceId!, { limit: 100 }),
    enabled: !!workspaceId,
  });

  const humanMembers = useMemo(
    () => membersData?.members?.filter((m) => m.userType === "human") ?? [],
    [membersData],
  );

  const anyPending =
    startMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending;

  const handleCopyInstanceId = async () => {
    if (instanceStatus?.instanceId) {
      await navigator.clipboard.writeText(instanceStatus.instanceId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const isLoading = appsLoading || botsLoading;
  const displayName =
    currentBot?.displayName || openClawApp?.name || "AI Staff";
  const isRunning = instanceStatus?.status === "running";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <main className="h-full flex flex-col bg-background">
      {/* Content Header */}
      <header className="h-14 bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/ai-staff" })}
          >
            <ArrowLeft size={18} />
          </Button>
          <Bot size={18} className="text-primary" />
          <h2 className="font-semibold text-lg text-foreground">
            {t("aiStaff")}
          </h2>
        </div>
      </header>

      <Separator />

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0 bg-secondary/50">
        <div className="p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && !currentBot && (
            <Card className="p-6 text-center">
              <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Bot not found</p>
            </Card>
          )}

          {!isLoading && currentBot && openClawApp && (
            <div className="space-y-6">
              {/* Profile Card */}
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <Avatar className="w-16 h-16">
                        <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background",
                          isRunning ? "bg-success" : "bg-muted-foreground",
                        )}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingName ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                            className="h-8 text-lg font-semibold"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && nameInput.trim()) {
                                renameBotMutation.mutate(nameInput.trim());
                              }
                              if (e.key === "Escape") {
                                setEditingName(false);
                              }
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            disabled={
                              !nameInput.trim() || renameBotMutation.isPending
                            }
                            onClick={() =>
                              renameBotMutation.mutate(nameInput.trim())
                            }
                          >
                            {renameBotMutation.isPending ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                          </Button>
                        </div>
                      ) : (
                        <div
                          className="group flex items-center gap-1 cursor-pointer"
                          onClick={() => {
                            setNameInput(displayName);
                            setEditingName(true);
                          }}
                        >
                          <h3 className="text-lg font-semibold text-foreground truncate">
                            {displayName}
                          </h3>
                          <Badge
                            variant={isDefault ? "default" : "secondary"}
                            className="text-xs ml-1"
                          >
                            {isDefault ? "Default" : "Agent"}
                          </Badge>
                          <Pencil
                            size={12}
                            className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          />
                        </div>
                      )}
                      {currentBot.username && (
                        <p className="text-sm text-muted-foreground">
                          @{currentBot.username}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          variant={
                            openClawApp.status === "active"
                              ? "default"
                              : "secondary"
                          }
                          className="text-xs"
                        >
                          {openClawApp.status}
                        </Badge>
                        {instanceStatus && (
                          <Badge
                            variant={statusBadgeVariant(instanceStatus.status)}
                            className="text-xs"
                          >
                            {instanceStatus.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Mentor */}
                  <div className="flex items-center justify-between mt-4">
                    <div className="flex items-center gap-2">
                      {currentBot.mentorAvatarUrl ? (
                        <Avatar className="w-5 h-5">
                          <AvatarImage src={currentBot.mentorAvatarUrl} />
                        </Avatar>
                      ) : (
                        <Avatar className="w-5 h-5">
                          <AvatarFallback className="bg-muted text-muted-foreground text-[8px]">
                            <User size={12} />
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <span className="text-sm text-muted-foreground">
                        Mentor
                      </span>
                    </div>
                    <Select
                      value={currentBot.mentorId ?? "__none__"}
                      onValueChange={(value) =>
                        mentorMutation.mutate(
                          value === "__none__" ? null : value,
                        )
                      }
                      disabled={mentorMutation.isPending}
                    >
                      <SelectTrigger className="w-48 h-8 text-sm">
                        <SelectValue placeholder="Select mentor..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {humanMembers.map((member) => (
                          <SelectItem key={member.userId} value={member.userId}>
                            {member.displayName || member.username}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Description */}
                  <div className="mt-4">
                    {editingDesc ? (
                      <div className="flex items-start gap-1.5">
                        <Input
                          value={descInput}
                          onChange={(e) => setDescInput(e.target.value)}
                          className="flex-1 text-sm"
                          placeholder="Add a description..."
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              updateDescMutation.mutate(descInput.trim());
                            }
                            if (e.key === "Escape") {
                              setEditingDesc(false);
                            }
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          disabled={updateDescMutation.isPending}
                          onClick={() =>
                            updateDescMutation.mutate(descInput.trim())
                          }
                        >
                          {updateDescMutation.isPending ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="group flex items-center gap-1 cursor-pointer"
                        onClick={() => {
                          setDescInput(openClawApp.description ?? "");
                          setEditingDesc(true);
                        }}
                      >
                        <p className="text-sm text-muted-foreground">
                          {openClawApp.description || "Add a description..."}
                        </p>
                        <Pencil
                          size={12}
                          className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        />
                      </div>
                    )}
                  </div>

                  {/* Delete button (non-default only) */}
                  {!isDefault && (
                    <div className="mt-4 pt-3 border-t">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? (
                              <Loader2
                                size={14}
                                className="mr-1 animate-spin"
                              />
                            ) : (
                              <Trash2 size={14} className="mr-1" />
                            )}
                            Delete Agent
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the agent &quot;
                              {currentBot.displayName}&quot; and its associated
                              bot account. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate()}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Tabs */}
              <Tabs defaultValue="instance">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="instance">Instance</TabsTrigger>
                  <TabsTrigger value="workspace">Workspace</TabsTrigger>
                </TabsList>

                <TabsContent value="instance" className="mt-4">
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      {statusLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : instanceStatus ? (
                        <>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">
                                Instance ID
                              </span>
                              <div className="flex items-center gap-1.5">
                                <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                                  {instanceStatus.instanceId}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={handleCopyInstanceId}
                                >
                                  {copiedId ? (
                                    <Check size={12} />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </Button>
                              </div>
                            </div>

                            {instanceStatus.accessUrl && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">
                                  Access URL
                                </span>
                                <a
                                  href={instanceStatus.accessUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary hover:underline flex items-center gap-1"
                                >
                                  {instanceStatus.accessUrl}
                                  <ExternalLink size={10} />
                                </a>
                              </div>
                            )}

                            {instanceStatus.createdAt && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">
                                  Created
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(instanceStatus.createdAt)}
                                </span>
                              </div>
                            )}

                            {instanceStatus.lastHeartbeat && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">
                                  Last Heartbeat
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(instanceStatus.lastHeartbeat)}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex gap-2 pt-2">
                            <Button
                              size="sm"
                              disabled={
                                anyPending ||
                                instanceStatus.status === "running"
                              }
                              onClick={() => startMutation.mutate()}
                            >
                              {startMutation.isPending ? (
                                <Loader2
                                  size={14}
                                  className="mr-1 animate-spin"
                                />
                              ) : (
                                <Play size={14} className="mr-1" />
                              )}
                              Start
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={
                                anyPending ||
                                instanceStatus.status === "stopped"
                              }
                              onClick={() => stopMutation.mutate()}
                            >
                              {stopMutation.isPending ? (
                                <Loader2
                                  size={14}
                                  className="mr-1 animate-spin"
                                />
                              ) : (
                                <Square size={14} className="mr-1" />
                              )}
                              Stop
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={anyPending}
                              onClick={() => restartMutation.mutate()}
                            >
                              {restartMutation.isPending ? (
                                <Loader2
                                  size={14}
                                  className="mr-1 animate-spin"
                                />
                              ) : (
                                <RotateCw size={14} className="mr-1" />
                              )}
                              Restart
                            </Button>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No instance information available
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="workspace" className="mt-0 -mx-4">
                  <div className="h-[calc(100vh-220px)]">
                    {appId && (
                      <WorkspaceFileBrowserContent
                        staffId={appId}
                        workspaceName={currentBot?.workspace ?? "default"}
                        embedded
                      />
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
  );
}
