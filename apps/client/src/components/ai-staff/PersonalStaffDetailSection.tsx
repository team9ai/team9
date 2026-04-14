import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Camera,
  Check,
  Pencil,
  Trash2,
  MessageSquare,
  Loader2,
  Wand2,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MemoryTab } from "@/components/ai-staff/memory/MemoryTab";
import { WorkfileTab } from "@/components/ai-staff/workfile/WorkfileTab";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import { useCreateDirectChannel } from "@/hooks/useChannels";
import { COMMON_STAFF_MODELS } from "@/lib/common-staff-models";
import { formatDateTime } from "@/lib/date-format";
import type {
  PersonalStaffListBotInfo,
  InstalledApplicationWithBots,
  UpdatePersonalStaffDto,
} from "@/services/api/applications";

interface PersonalStaffDetailSectionProps {
  bot: PersonalStaffListBotInfo;
  app: InstalledApplicationWithBots;
  workspaceId: string;
}

const DICEBEAR_PRESETS = Array.from({ length: 8 }, (_, i) => ({
  url: `https://api.dicebear.com/9.x/avataaars/svg?seed=ps-${i}`,
  seed: `ps-${i}`,
}));

function formatDate(dateStr: string) {
  return formatDateTime(dateStr);
}

const VISIBILITY_WARNING =
  "Enabling this will allow other workspace members to interact with your personal assistant. Your assistant may reference information from your previous conversations when responding to others. Please be aware of potential information exposure.";

export function PersonalStaffDetailSection({
  bot,
  app,
  workspaceId,
}: PersonalStaffDetailSectionProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createDirectChannel = useCreateDirectChannel();

  // Avatar popover state
  const [avatarPopoverOpen, setAvatarPopoverOpen] = useState(false);

  // Inline editing state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingPersona, setEditingPersona] = useState(false);
  const [personaInput, setPersonaInput] = useState("");
  const [isGeneratingPersona, setIsGeneratingPersona] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  // Visibility privacy warning dialog state
  const [visibilityDialogOpen, setVisibilityDialogOpen] = useState(false);
  const [pendingVisibilityField, setPendingVisibilityField] = useState<
    "allowMention" | "allowDirectMessage" | null
  >(null);

  const displayName = bot.displayName || "Personal Assistant";
  const initials = displayName.slice(0, 2).toUpperCase();
  const isRunning = bot.isActive;
  const appId = app.id;

  // Current model value
  const effectiveModel = bot.model ?? {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
  };
  const currentModelValue = `${effectiveModel.provider}::${effectiveModel.id}`;

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (body: UpdatePersonalStaffDto) =>
      api.applications.updatePersonalStaff(appId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["personal-staff", appId],
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => api.applications.deletePersonalStaff(appId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
      void navigate({ to: "/ai-staff" });
    },
  });

  const handleOpenChat = async () => {
    if (!bot.userId) return;
    try {
      const channel = await createDirectChannel.mutateAsync(bot.userId);
      void navigate({
        to: "/messages/$channelId",
        params: { channelId: channel.id },
      });
    } catch (error) {
      console.error("Failed to open personal staff chat", error);
    }
  };

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setSavingField("name");
    updateMutation.mutate(
      { displayName: trimmed },
      {
        onSuccess: () => setEditingName(false),
        onSettled: () => setSavingField(null),
      },
    );
  };

  const handleSavePersona = () => {
    const trimmed = personaInput.trim();
    setSavingField("persona");
    updateMutation.mutate(
      { persona: trimmed || null },
      {
        onSuccess: () => setEditingPersona(false),
        onSettled: () => setSavingField(null),
      },
    );
  };

  const handleModelChange = (value: string) => {
    const [provider, id] = value.split("::");
    if (!provider || !id) return;
    setSavingField("model");
    updateMutation.mutate(
      { model: { provider, id } },
      { onSettled: () => setSavingField(null) },
    );
  };

  const handleAvatarSelect = (presetUrl: string) => {
    setSavingField("avatar");
    updateMutation.mutate(
      { avatarUrl: presetUrl },
      { onSettled: () => setSavingField(null) },
    );
    setAvatarPopoverOpen(false);
  };

  const handleGeneratePersona = async () => {
    setIsGeneratingPersona(true);
    let generated = "";
    try {
      for await (const chunk of api.applications.generatePersonalStaffPersona(
        appId,
        {
          displayName: bot.displayName ?? displayName,
        },
      )) {
        generated += chunk;
      }
      if (generated) {
        const trimmedPersona = generated.trim();
        setSavingField("persona");
        updateMutation.mutate(
          { persona: trimmedPersona },
          {
            onSuccess: () => {
              setPersonaInput(trimmedPersona);
              setEditingPersona(true);
            },
            onSettled: () => setSavingField(null),
          },
        );
      }
    } catch (error) {
      console.error("Failed to generate persona", error);
    } finally {
      setIsGeneratingPersona(false);
    }
  };

  // Visibility toggle handler — shows warning when enabling
  const handleVisibilityToggle = (
    field: "allowMention" | "allowDirectMessage",
    checked: boolean,
  ) => {
    if (checked) {
      // Enabling — show privacy warning
      setPendingVisibilityField(field);
      setVisibilityDialogOpen(true);
    } else {
      // Disabling — apply immediately
      setSavingField(`visibility-${field}`);
      updateMutation.mutate(
        { visibility: { [field]: false } },
        { onSettled: () => setSavingField(null) },
      );
    }
  };

  const handleConfirmVisibility = () => {
    if (!pendingVisibilityField) return;
    setSavingField(`visibility-${pendingVisibilityField}`);
    updateMutation.mutate(
      { visibility: { [pendingVisibilityField]: true } },
      { onSettled: () => setSavingField(null) },
    );
    setVisibilityDialogOpen(false);
    setPendingVisibilityField(null);
  };

  const handleCancelVisibility = () => {
    setVisibilityDialogOpen(false);
    setPendingVisibilityField(null);
  };

  return (
    <div className="space-y-6">
      {/* Profile Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="relative">
              <Popover
                open={avatarPopoverOpen}
                onOpenChange={setAvatarPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    className="group relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Change avatar"
                    disabled={savingField === "avatar"}
                  >
                    <Avatar className="w-16 h-16">
                      {bot.avatarUrl && (
                        <AvatarImage
                          src={bot.avatarUrl}
                          alt={bot.displayName ?? "Personal staff avatar"}
                        />
                      )}
                      <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
                        {savingField === "avatar" ? (
                          <Loader2 size={20} className="animate-spin" />
                        ) : (
                          initials
                        )}
                      </AvatarFallback>
                    </Avatar>
                    {/* Hover overlay */}
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <Camera size={18} className="text-white" />
                    </div>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-48 p-2"
                  side="bottom"
                  align="start"
                >
                  <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                    Choose avatar
                  </p>
                  <div className="grid grid-cols-4 gap-1">
                    {DICEBEAR_PRESETS.map((preset) => (
                      <button
                        key={preset.seed}
                        className={cn(
                          "rounded-full overflow-hidden border-2 transition-all hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          bot.avatarUrl === preset.url
                            ? "border-primary"
                            : "border-transparent",
                        )}
                        onClick={() => handleAvatarSelect(preset.url)}
                        aria-label={`Select avatar ${preset.seed}`}
                      >
                        <img
                          src={preset.url}
                          alt={preset.seed}
                          className="h-9 w-9"
                        />
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <div
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background",
                  isRunning ? "bg-success" : "bg-muted-foreground",
                )}
              />
            </div>

            {/* Name + role */}
            <div className="flex-1 min-w-0">
              {/* Display Name */}
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="h-8 text-lg font-semibold"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && nameInput.trim()) {
                        handleSaveName();
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
                    disabled={!nameInput.trim() || savingField === "name"}
                    onClick={handleSaveName}
                  >
                    {savingField === "name" ? (
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
                  <Pencil
                    size={12}
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  />
                </div>
              )}

              {/* Role Title (read-only) */}
              <p className="text-sm text-muted-foreground mt-0.5">
                Personal Assistant
              </p>

              {/* Status */}
              <div className="flex items-center gap-2 mt-2">
                <Badge
                  variant={isRunning ? "default" : "secondary"}
                  className="text-xs"
                >
                  {isRunning ? "online" : "offline"}
                </Badge>
              </div>
            </div>

            {/* Chat Button */}
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={createDirectChannel.isPending || !bot.userId}
              onClick={() => {
                void handleOpenChat();
              }}
            >
              <MessageSquare size={14} className="mr-1" />
              Chat
            </Button>
          </div>

          {/* Delete Section */}
          <div className="mt-4 pt-3 border-t">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? (
                    <Loader2 size={14} className="mr-1 animate-spin" />
                  ) : (
                    <Trash2 size={14} className="mr-1" />
                  )}
                  Delete Staff
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Personal Staff</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete your personal assistant
                    &quot;{bot.displayName}&quot;? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteMutation.mutate()}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Staff Details Section */}
      <Card>
        <Tabs defaultValue="details">
          <CardHeader className="pb-0">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="details">Staff Details</TabsTrigger>
              <TabsTrigger value="memory">Memory</TabsTrigger>
              <TabsTrigger value="workfile">Workfile</TabsTrigger>
            </TabsList>
          </CardHeader>
          <TabsContent value="details">
            <CardContent className="space-y-5">
              {/* Persona */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    Persona
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    disabled={isGeneratingPersona || savingField === "persona"}
                    onClick={() => {
                      void handleGeneratePersona();
                    }}
                  >
                    {isGeneratingPersona ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Wand2 size={12} />
                    )}
                    AI Generate
                  </Button>
                </div>
                {editingPersona ? (
                  <div className="space-y-1.5">
                    <Textarea
                      value={personaInput}
                      onChange={(e) => setPersonaInput(e.target.value)}
                      className="text-sm min-h-[120px] resize-y"
                      placeholder="Describe your personal assistant's persona..."
                      autoFocus
                    />
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={savingField === "persona"}
                        onClick={handleSavePersona}
                      >
                        {savingField === "persona" ? (
                          <Loader2 size={12} className="animate-spin mr-1" />
                        ) : (
                          <Check size={12} className="mr-1" />
                        )}
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setEditingPersona(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="group relative cursor-pointer rounded-md border border-transparent hover:border-border p-2 -mx-2 transition-colors"
                    onClick={() => {
                      setPersonaInput(bot.persona ?? "");
                      setEditingPersona(true);
                    }}
                  >
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {bot.persona || (
                        <span className="italic">Click to add persona...</span>
                      )}
                    </p>
                    <Pencil
                      size={11}
                      className="absolute top-2 right-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                )}
              </div>

              {/* Model */}
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm font-medium text-foreground shrink-0">
                  Model
                </label>
                <Select
                  value={currentModelValue}
                  onValueChange={handleModelChange}
                  disabled={savingField === "model"}
                >
                  <SelectTrigger className="w-52 h-8 text-sm">
                    <SelectValue placeholder="Select model..." />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_STAFF_MODELS.map((m) => (
                      <SelectItem
                        key={`${m.provider}::${m.id}`}
                        value={`${m.provider}::${m.id}`}
                      >
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Job Description (read-only) */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Job Description
                </label>
                <p className="text-sm text-muted-foreground p-2 -mx-2">
                  Personal AI assistant
                </p>
              </div>

              {/* Created At */}
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted-foreground">Created</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(bot.createdAt)}
                </span>
              </div>
            </CardContent>
          </TabsContent>
          <TabsContent value="memory">
            <CardContent>
              <MemoryTab />
            </CardContent>
          </TabsContent>
          <TabsContent value="workfile">
            <CardContent>
              <WorkfileTab />
            </CardContent>
          </TabsContent>
        </Tabs>
      </Card>

      {/* Visibility Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert size={16} />
            Visibility
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Control how other workspace members can interact with your personal
            assistant.
          </p>

          {/* Allow @mentions */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <label className="text-sm font-medium text-foreground">
                Allow @mentions
              </label>
              <p className="text-xs text-muted-foreground">
                Others can mention your assistant in channels
              </p>
            </div>
            <Switch
              checked={bot.visibility.allowMention}
              disabled={
                savingField === "visibility-allowMention" ||
                updateMutation.isPending
              }
              onCheckedChange={(checked) =>
                handleVisibilityToggle("allowMention", checked)
              }
            />
          </div>

          {/* Allow direct messages */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <label className="text-sm font-medium text-foreground">
                Allow direct messages
              </label>
              <p className="text-xs text-muted-foreground">
                Others can send DMs to your assistant
              </p>
            </div>
            <Switch
              checked={bot.visibility.allowDirectMessage}
              disabled={
                savingField === "visibility-allowDirectMessage" ||
                updateMutation.isPending
              }
              onCheckedChange={(checked) =>
                handleVisibilityToggle("allowDirectMessage", checked)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Visibility Privacy Warning Dialog */}
      <AlertDialog
        open={visibilityDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelVisibility();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Privacy Notice</AlertDialogTitle>
            <AlertDialogDescription>
              {VISIBILITY_WARNING}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelVisibility}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmVisibility}>
              Enable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
