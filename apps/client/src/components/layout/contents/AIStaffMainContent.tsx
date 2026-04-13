import {
  Bot,
  Loader2,
  AlertCircle,
  User,
  Plus,
  MessageSquare,
  Lock,
  ChevronDown,
  ChevronRight,
  Shield,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState, useMemo } from "react";
import { api } from "@/services/api";
import type {
  BaseModelStaffBotInfo,
  CommonStaffBotInfo,
  InstalledApplicationWithBots,
  OpenClawBotInfo,
  OpenClawInstanceStatus,
  PersonalStaffListBotInfo,
} from "@/services/api/applications";
import { cn } from "@/lib/utils";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { BaseModelProductLogo } from "@/components/applications/BaseModelProductLogo";
import { CreateCommonStaffDialog } from "@/components/ai-staff/CreateCommonStaffDialog";
import { useCreateDirectChannel } from "@/hooks/useChannels";
import { useCurrentUser } from "@/hooks/useAuth";
import { useWorkspaceMembers } from "@/hooks/useWorkspace";
import { getHttpErrorMessage, getHttpErrorStatus } from "@/lib/http-error";

// ── Type guard ────────────────────────────────────────────────────────

type AIStaffBot =
  | OpenClawBotInfo
  | BaseModelStaffBotInfo
  | CommonStaffBotInfo
  | PersonalStaffListBotInfo;

function isOpenClawBot(bot: AIStaffBot): bot is OpenClawBotInfo {
  return "agentId" in bot && "workspace" in bot;
}

function isBaseModelStaffBot(bot: AIStaffBot): bot is BaseModelStaffBotInfo {
  return "managedMeta" in bot && "agentType" in bot;
}

function isCommonStaffBot(bot: AIStaffBot): bot is CommonStaffBotInfo {
  return (
    "managedMeta" in bot &&
    typeof (bot as CommonStaffBotInfo).managedMeta?.agentId === "string" &&
    ((bot as CommonStaffBotInfo).managedMeta?.agentId ?? "").startsWith(
      "common-staff-",
    )
  );
}

function isPersonalStaffBot(bot: AIStaffBot): bot is PersonalStaffListBotInfo {
  return "ownerId" in bot && "visibility" in bot;
}

// ── Section header ──────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  pinned?: boolean;
  sub?: boolean;
}

function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
  pinned,
  sub,
}: SectionHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 w-full py-2 px-1 text-muted-foreground hover:text-foreground transition-colors",
        sub ? "pl-4 text-xs font-medium" : "text-sm font-semibold",
      )}
    >
      {pinned ? null : expanded ? (
        <ChevronDown size={sub ? 12 : 14} />
      ) : (
        <ChevronRight size={sub ? 12 : 14} />
      )}
      <span>{title}</span>
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-auto">
        {count}
      </Badge>
    </button>
  );
}

// ── Chat button ─────────────────────────────────────────────────────

interface ChatButtonProps {
  targetUserId: string;
  disabled?: boolean;
  isRestricted?: boolean;
}

function ChatButton({ targetUserId, disabled, isRestricted }: ChatButtonProps) {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const createDM = useCreateDirectChannel();

  const handleChat = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const channel = await createDM.mutateAsync(targetUserId);
      navigate({
        to: "/messages/$channelId",
        params: { channelId: channel.id },
      });
    } catch (error: unknown) {
      const status = getHttpErrorStatus(error);
      if (status === 403) {
        alert(t("dmPermissionDenied"));
      } else {
        const message = getHttpErrorMessage(error);
        alert(message || "Failed to create conversation");
      }
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleChat}
      disabled={disabled || createDM.isPending}
      className="shrink-0 gap-1 text-xs"
      title={isRestricted ? t("dmPermissionDenied") : t("chatButton")}
    >
      <MessageSquare size={14} />
      {t("chatButton")}
    </Button>
  );
}

// ── Per-bot card ─────────────────────────────────────────────────────

interface AIStaffBotCardProps {
  app: InstalledApplicationWithBots;
  bot: AIStaffBot;
  instanceStatus?: OpenClawInstanceStatus;
  showChatButton?: boolean;
  isOtherPersonalStaff?: boolean;
  badge?: string;
}

function AIStaffBotCard({
  app,
  bot,
  instanceStatus,
  showChatButton,
  isOtherPersonalStaff,
  badge,
}: AIStaffBotCardProps) {
  const navigate = useNavigate();

  const displayName = bot.displayName || app.name || "AI Staff";
  const isRunning = instanceStatus?.status === "running";
  const initials = displayName.slice(0, 2).toUpperCase();
  const isOcBot = isOpenClawBot(bot);
  const isBaseModelBot = isBaseModelStaffBot(bot);
  const isCommonStaff = isCommonStaffBot(bot);
  const isPsBot = isPersonalStaffBot(bot);
  const isDefault = isOcBot && !bot.agentId;

  // For common staff, derive status from bot.isActive since no instanceStatus
  const isActiveBot = isCommonStaff || isPsBot ? bot.isActive : isRunning;

  // Check if DM is restricted for other users' personal staff
  const isRestricted =
    isPsBot && isOtherPersonalStaff && !bot.visibility.allowDirectMessage;

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
          {isBaseModelBot ? (
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-background ring-1 ring-border/50">
              <BaseModelProductLogo agentId={bot.managedMeta?.agentId} />
            </div>
          ) : (isCommonStaff || isPsBot) &&
            "avatarUrl" in bot &&
            bot.avatarUrl ? (
            <Avatar className="w-12 h-12">
              <AvatarImage
                src={bot.avatarUrl}
                alt={bot.displayName ?? "Staff"}
              />
              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                {initials}
              </AvatarFallback>
            </Avatar>
          ) : (
            <Avatar className="w-12 h-12">
              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                {initials}
              </AvatarFallback>
            </Avatar>
          )}
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-background",
              isActiveBot ? "bg-success" : "bg-muted-foreground",
            )}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground truncate">
              {displayName}
            </p>
            {isOtherPersonalStaff && (
              <Lock size={12} className="text-muted-foreground shrink-0" />
            )}
            {isOcBot && (
              <Badge
                variant={isDefault ? "default" : "secondary"}
                className="shrink-0 text-[10px] px-1.5 py-0"
              >
                {isDefault ? "Default" : "Agent"}
              </Badge>
            )}
            {isCommonStaff && "roleTitle" in bot && bot.roleTitle && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] px-1.5 py-0"
              >
                {bot.roleTitle}
              </Badge>
            )}
            {badge && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] px-1.5 py-0"
              >
                <Shield size={8} className="mr-0.5" />
                {badge}
              </Badge>
            )}
          </div>
          {"username" in bot && bot.username && (
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
          {(isOcBot || isCommonStaff) &&
            "mentorDisplayName" in bot &&
            bot.mentorDisplayName && (
              <div className="flex items-center gap-1 mt-1">
                <Avatar className="w-4 h-4">
                  {"mentorAvatarUrl" in bot && bot.mentorAvatarUrl ? (
                    <AvatarImage
                      src={bot.mentorAvatarUrl}
                      alt={bot.mentorDisplayName}
                    />
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

        {/* Chat button */}
        {showChatButton && (
          <ChatButton targetUserId={bot.userId} isRestricted={isRestricted} />
        )}
      </div>
    </Card>
  );
}

// ── Member card ──────────────────────────────────────────────────────

interface MemberCardProps {
  member: {
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
  };
}

function MemberCard({ member }: MemberCardProps) {
  return (
    <Card className="p-4 transition-all hover:shadow-md">
      <div className="flex items-center gap-4">
        <UserAvatar
          userId={member.userId}
          name={member.displayName}
          username={member.username}
          avatarUrl={member.avatarUrl}
          className="w-12 h-12"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {member.displayName || member.username}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            @{member.username}
          </p>
        </div>
        <ChatButton targetUserId={member.userId} />
      </div>
    </Card>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function AIStaffMainContent() {
  const { t } = useTranslation("navigation");
  const workspaceId = useSelectedWorkspaceId();
  const { data: currentUser } = useCurrentUser();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [aiStaffExpanded, setAiStaffExpanded] = useState(true);
  const [membersExpanded, setMembersExpanded] = useState(true);
  const [appGroupExpanded, setAppGroupExpanded] = useState<
    Record<string, boolean>
  >({});

  // Fetch installed applications with bots
  const {
    data: installedApps,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId],
    queryFn: () => api.applications.getInstalledApplicationsWithBots(),
    enabled: !!workspaceId,
  });

  // Fetch workspace members (human only)
  const { data: membersData, isLoading: membersLoading } = useWorkspaceMembers(
    workspaceId || undefined,
    { limit: 50 },
  );

  const humanMembers = useMemo(() => {
    const all = membersData?.pages.flatMap((page) => page.members) ?? [];
    return all.filter((m) => m.userType === "human");
  }, [membersData]);

  // Categorize bots into sections, with AI staff grouped by app
  interface AIStaffBotEntry {
    app: InstalledApplicationWithBots;
    bot: AIStaffBot;
    isOtherPersonalStaff: boolean;
  }
  interface AppGroup {
    app: InstalledApplicationWithBots;
    bots: AIStaffBotEntry[];
  }

  const { myPersonalStaff, aiStaffGroups, aiStaffTotalCount } = useMemo(() => {
    if (!installedApps || !currentUser?.id) {
      return {
        myPersonalStaff: [] as {
          app: InstalledApplicationWithBots;
          bot: AIStaffBot;
        }[],
        aiStaffGroups: [] as AppGroup[],
        aiStaffTotalCount: 0,
      };
    }

    const myPS: { app: InstalledApplicationWithBots; bot: AIStaffBot }[] = [];
    const groupMap = new Map<string, AppGroup>();

    for (const app of installedApps) {
      if (app.status !== "active") continue;

      if (app.applicationId === "personal-staff") {
        const otherPersonalBots: AIStaffBotEntry[] = [];
        for (const bot of app.bots) {
          if (isPersonalStaffBot(bot) && bot.ownerId === currentUser.id) {
            myPS.push({ app, bot });
          } else if (isPersonalStaffBot(bot)) {
            const visible =
              bot.visibility.allowMention || bot.visibility.allowDirectMessage;
            if (visible) {
              otherPersonalBots.push({
                app,
                bot,
                isOtherPersonalStaff: true,
              });
            }
          }
        }
        if (otherPersonalBots.length > 0) {
          groupMap.set(app.id, { app, bots: otherPersonalBots });
        }
        continue;
      }

      // Common staff, openclaw, base-model-staff
      const bots: AIStaffBotEntry[] = app.bots.map((bot) => ({
        app,
        bot,
        isOtherPersonalStaff: false,
      }));
      if (bots.length > 0) {
        groupMap.set(app.id, { app, bots });
      }
    }

    const groups = Array.from(groupMap.values());
    const total = groups.reduce((sum, g) => sum + g.bots.length, 0);

    return {
      myPersonalStaff: myPS,
      aiStaffGroups: groups,
      aiStaffTotalCount: total,
    };
  }, [installedApps, currentUser?.id]);

  const openClawApps =
    installedApps?.filter(
      (a) => a.applicationId === "openclaw" && a.status === "active",
    ) ?? [];

  const commonStaffApp = installedApps?.find(
    (a) => a.applicationId === "common-staff",
  );

  const hasCreateButton = !!commonStaffApp || openClawApps.length > 0;

  return (
    <main className="h-full flex flex-col bg-background overflow-hidden">
      {/* Content Header */}
      <header className="h-14 bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-primary" />
          <h2 className="font-semibold text-lg text-foreground">
            {t("staff")}
          </h2>
        </div>
        {hasCreateButton && (
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <Plus size={14} className="mr-1" />
            Create
          </Button>
        )}
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

          {error && (
            <Card className="p-6 text-center">
              <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Failed to load Staff
              </p>
            </Card>
          )}

          {!isLoading && !error && (
            <div className="mx-auto max-w-5xl space-y-4">
              {/* Section 1: My Personal Staff */}
              <div>
                <SectionHeader
                  title={t("myPersonalStaff")}
                  count={myPersonalStaff.length}
                  expanded={true}
                  onToggle={() => {}}
                  pinned
                />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pl-4">
                  {myPersonalStaff.length === 0 ? (
                    <Card className="p-4 text-center border-dashed col-span-full">
                      <p className="text-sm text-muted-foreground">
                        {t("aiStaffDescription")}
                      </p>
                    </Card>
                  ) : (
                    myPersonalStaff.map(({ app, bot }) => (
                      <AIStaffBotCard
                        key={bot.botId}
                        app={app}
                        bot={bot}
                        showChatButton
                        badge={t("personalAssistant")}
                      />
                    ))
                  )}
                </div>
              </div>

              <Separator />

              {/* Section 2: AI Staff (grouped by app) */}
              <div>
                <SectionHeader
                  title={t("aiStaffSection")}
                  count={aiStaffTotalCount}
                  expanded={aiStaffExpanded}
                  onToggle={() => setAiStaffExpanded((p) => !p)}
                />
                {aiStaffExpanded && (
                  <div className="space-y-3">
                    {aiStaffGroups.length === 0 ? (
                      <Card className="p-4 text-center border-dashed">
                        <p className="text-sm text-muted-foreground">
                          No AI staff members yet
                        </p>
                      </Card>
                    ) : (
                      aiStaffGroups.map((group) => {
                        const isExpanded =
                          appGroupExpanded[group.app.id] !== false;
                        return (
                          <div key={group.app.id}>
                            <SectionHeader
                              title={group.app.name}
                              count={group.bots.length}
                              expanded={isExpanded}
                              onToggle={() =>
                                setAppGroupExpanded((prev) => ({
                                  ...prev,
                                  [group.app.id]: !isExpanded,
                                }))
                              }
                              sub
                            />
                            {isExpanded && (
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pl-4">
                                {group.bots.map(
                                  ({ app, bot, isOtherPersonalStaff }) => (
                                    <AIStaffBotCard
                                      key={bot.botId}
                                      app={app}
                                      bot={bot}
                                      instanceStatus={
                                        app.instanceStatus ?? undefined
                                      }
                                      showChatButton
                                      isOtherPersonalStaff={
                                        isOtherPersonalStaff
                                      }
                                      badge={
                                        isOtherPersonalStaff
                                          ? t("personalAssistant")
                                          : undefined
                                      }
                                    />
                                  ),
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* Section 3: Members */}
              <div>
                <SectionHeader
                  title={t("membersSection")}
                  count={humanMembers.length}
                  expanded={membersExpanded}
                  onToggle={() => setMembersExpanded((p) => !p)}
                />
                {membersExpanded && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pl-4">
                    {membersLoading ? (
                      <div className="flex items-center justify-center py-4 col-span-full">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : humanMembers.length === 0 ? (
                      <Card className="p-4 text-center border-dashed col-span-full">
                        <p className="text-sm text-muted-foreground">
                          No other members
                        </p>
                      </Card>
                    ) : (
                      humanMembers.map((member) => (
                        <MemberCard key={member.userId} member={member} />
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {(commonStaffApp || openClawApps.length > 0) && (
        <CreateCommonStaffDialog
          appId={commonStaffApp?.id}
          openClawApps={openClawApps}
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
        />
      )}
    </main>
  );
}
