import {
  Map,
  Bot,
  UserPlus,
  MessageSquare,
  Loader2,
  X,
  Wrench,
  ArrowRight,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import {
  useUserWorkspaces,
  useCreateInvitation,
  useWorkspaceInvitations,
} from "@/hooks/useWorkspace";
import { useSelectedWorkspaceId, useUser } from "@/stores";
import { useChannelsByType } from "@/hooks/useChannels";
import { useEffectOncePerKey } from "@/hooks/useEffectOncePerKey";
import { CreateChannelDialog } from "@/components/dialog/CreateChannelDialog";

const DEFAULT_INVITATION_OPTIONS = {
  role: "member" as const,
  maxUses: 1000,
  expiresInDays: 100,
};

export function HomeMainContent() {
  const { t } = useTranslation(["navigation", "common"]);
  const workspaceId = useSelectedWorkspaceId();
  const { data: workspaces } = useUserWorkspaces();
  const currentWorkspace = workspaces?.find((w) => w.id === workspaceId);
  const [copied, setCopied] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isWarmupDismissed, setIsWarmupDismissed] = useState(false);
  const navigate = useNavigate();
  const { directChannels = [] } = useChannelsByType();
  const user = useUser();
  const isNewUser = useMemo(() => {
    if (!user?.createdAt) return false;
    const createdAt = new Date(user.createdAt);
    const now = new Date();
    const tenMinutesInMs = 10 * 60 * 1000;
    return now.getTime() - createdAt.getTime() < tenMinutesInMs;
  }, [user?.createdAt]);
  const { data: invitations = [] } = useWorkspaceInvitations(
    workspaceId ?? undefined,
  );
  const createInvitation = useCreateInvitation(workspaceId ?? undefined);

  const validInvitation = useMemo(
    () =>
      invitations.find((inv) => {
        if (!inv.isActive) return false;
        if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) return false;
        if (inv.maxUses && inv.usedCount >= inv.maxUses) return false;
        return true;
      }),
    [invitations],
  );

  useEffectOncePerKey(
    workspaceId,
    Boolean(workspaceId) && !validInvitation,
    () => {
      createInvitation.mutate({
        ...DEFAULT_INVITATION_OPTIONS,
      });
    },
  );

  const inviteUrl = validInvitation?.url;

  const handleStartChatWithBot = () => {
    const botChannel = directChannels.find(
      (ch) => ch.otherUser?.userType === "bot",
    );
    if (botChannel) {
      navigate({
        to: "/channels/$channelId",
        params: { channelId: botChannel.id },
      });
    }
  };

  const handleTryNow = (draft: string) => {
    const botChannel = directChannels.find(
      (ch) => ch.otherUser?.userType === "bot",
    );
    if (botChannel) {
      navigate({
        to: "/channels/$channelId",
        params: { channelId: botChannel.id },
        search: { draft },
      });
    }
  };

  const tryNowItems = [
    {
      title: "X API",
      prompt:
        "How many tweets did Elon Musk post today? Provide the original text, the original link for each, and an overall summary.",
    },
    {
      title: "X Trend API",
      prompt:
        "What are the top 10 trending topics on Twitter in the North American market today?",
    },
    {
      title: "Web Search API",
      prompt: "Gold Price today",
    },
    {
      title: "Website Reader",
      prompt:
        "The main content of this article：https://openai.com/index/scaling-postgresql/",
    },
    {
      title: "Deep Research",
      prompt: "Deep Research, What are OpenClaw and Moltbook?",
    },
    {
      title: "Nano Banana Pro",
      prompt:
        "Generate an image of a cute robot mascot waving hello in a futuristic office, cartoon style",
    },
  ];

  const workspaceName = currentWorkspace?.name || "Workspace";

  const handleCopyLink = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="h-full flex flex-col bg-muted overflow-hidden">
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-8 max-w-6xl mx-auto">
          <div className="mb-10 flex items-center gap-6">
            <img
              src="/team9-block.png"
              alt="Team9"
              loading="lazy"
              width={80}
              height={80}
              className="w-20 h-20 object-cover shrink-0"
            />
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                {t("welcomeBackTo", { workspace: workspaceName })}
              </h1>
              <p className="text-muted-foreground text-base">
                {t("workspaceActivity")}
              </p>
            </div>
          </div>

          {isNewUser && !isWarmupDismissed && (
            <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-lg bg-info/10 border border-info/20">
              <Loader2 size={18} className="text-info animate-spin shrink-0" />
              <p className="text-sm text-foreground flex-1">
                {t("openclawWarmingUp", { name: user?.name })}
              </p>
              <button
                onClick={() => setIsWarmupDismissed(true)}
                className="p-1 rounded hover:bg-info/20 transition-colors shrink-0"
              >
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>
          )}

          <div className="flex gap-8">
            <div className="w-72 shrink-0 flex flex-col gap-6">
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
                      <Wrench size={16} className="text-warning" />
                    </div>
                    <h3 className="font-semibold text-base">
                      {t("supportedTools")}
                    </h3>
                  </div>
                  <div className="space-y-2.5">
                    {tryNowItems.map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted"
                      >
                        <span className="text-sm text-foreground">
                          {item.title}
                        </span>
                        <button
                          className="text-xs font-medium text-info border border-info/30 hover:bg-info/10 px-2 py-0.5 rounded-full cursor-pointer transition-colors duration-200 flex items-center gap-0.5 group"
                          onClick={() => handleTryNow(item.prompt)}
                        >
                          Try
                          <ArrowRight
                            size={11}
                            className="group-hover:translate-x-0.5 transition-transform duration-200"
                          />
                        </button>
                      </div>
                    ))}
                    {[
                      "Stock API",
                      "Youtube Reader",
                      "Veo 3.1",
                      "Eleven Labs API",
                      "Minimax Audio",
                      "Kling",
                      "Gemini Deep Research",
                      "Semrush API",
                      "Suno API",
                      "ChatGPT",
                      "Gemini",
                      "Claude Code",
                    ].map((name, i) => (
                      <div
                        key={`soon-${i}`}
                        className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted"
                      >
                        <span className="text-sm text-foreground">{name}</span>
                        <span className="text-xs text-muted-foreground bg-border px-2 py-0.5 rounded-full">
                          soon
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex-1 grid grid-cols-2 gap-6 auto-rows-min">
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
                      <Bot size={16} className="text-info" />
                    </div>
                    <h3 className="font-semibold text-base">
                      {t("chatWithOpenClaw")}
                    </h3>
                  </div>
                  <div className="flex items-center justify-center gap-3 mb-4">
                    <img
                      src="/bot.webp"
                      alt="OpenClaw"
                      className="w-11 h-11 rounded-full shadow-sm shrink-0"
                    />
                    <div className="relative border border-border rounded-xl px-3.5 py-2 text-sm text-muted-foreground bg-background shadow-sm">
                      HI its OpenClaw here!
                      <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rotate-45 border-l border-b border-border bg-background" />
                    </div>
                  </div>
                  <div className="mt-auto text-center">
                    <Button
                      size="sm"
                      className="bg-info hover:bg-info/90 text-primary-foreground rounded-lg px-6 cursor-pointer"
                      onClick={handleStartChatWithBot}
                    >
                      Start Chatting
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                      <UserPlus size={16} className="text-success" />
                    </div>
                    <h3 className="font-semibold text-base">
                      {t("inviteFriends")}
                    </h3>
                  </div>
                  <div className="bg-muted rounded-lg px-4 py-2.5 mb-4">
                    <span className="text-sm font-mono text-foreground truncate block">
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
                      {copied
                        ? t("navigation:copied")
                        : t("navigation:copyLink")}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Bot size={16} className="text-primary" />
                    </div>
                    <h3 className="font-semibold text-base">
                      {t("navigation:createOwnAIStaff")}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("navigation:aiStaffDescription")}
                  </p>
                  <div className="mt-auto text-center">
                    <Button
                      size="sm"
                      className="bg-info hover:bg-info/90 text-primary-foreground rounded-lg px-6 cursor-pointer"
                      onClick={() => navigate({ to: "/ai-staff" })}
                    >
                      {t("navigation:createAIStaff")}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
                      <MessageSquare size={16} className="text-warning" />
                    </div>
                    <h3 className="font-semibold text-base">
                      {t("navigation:joinBetaFeedback")}
                    </h3>
                  </div>
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center">
                      <svg
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="none"
                        className="text-warning"
                      >
                        <path
                          d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.36-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z"
                          fill="currentColor"
                        />
                      </svg>
                    </div>
                  </div>
                  <div className="mt-auto text-center">
                    <Button
                      size="sm"
                      className="bg-info hover:bg-info/90 text-primary-foreground rounded-lg px-6 cursor-pointer"
                      onClick={() =>
                        window.open("https://discord.gg/CAdS398wje", "_blank")
                      }
                    >
                      {t("navigation:joinDiscord")}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="col-span-2 border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                      <Map size={16} className="text-accent" />
                    </div>
                    <h3 className="font-semibold text-base">
                      {t("weeklyRoadmap")}
                    </h3>
                  </div>
                  <ul className="grid grid-cols-1 gap-y-3">
                    <li className="flex items-center gap-2.5">
                      <span
                        title="Done"
                        className="w-4 h-4 rounded-full bg-green-500 shrink-0 flex items-center justify-center cursor-help"
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          fill="none"
                        >
                          <path
                            d="M2 5.5L4 7.5L8 3"
                            stroke="white"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span className="text-sm text-foreground line-through text-muted-foreground">
                        {t("roadmapCreateAIStaff")}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span
                        title="In Progress"
                        className="w-4 h-4 rounded-full bg-info shrink-0 animate-pulse cursor-help"
                      />
                      <span className="text-sm text-foreground">
                        {t("roadmapAIStaffOnComputer")}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span
                        title="In Progress"
                        className="w-4 h-4 rounded-full bg-info shrink-0 animate-pulse cursor-help"
                      />
                      <span className="text-sm text-foreground">
                        {t("roadmapBigToolUpdate")}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span
                        title="Designed"
                        className="w-4 h-4 rounded-full bg-amber-400 shrink-0 flex items-center justify-center cursor-help"
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          fill="none"
                        >
                          <circle cx="5" cy="5" r="2" fill="white" />
                        </svg>
                      </span>
                      <span className="text-sm text-foreground">
                        {t("roadmapNewUI")}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span
                        title="Planned"
                        className="w-4 h-4 rounded-full bg-muted-foreground/30 shrink-0 flex items-center justify-center cursor-help"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t("roadmapDesktopApp")}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span
                        title="Planned"
                        className="w-4 h-4 rounded-full bg-muted-foreground/30 shrink-0 flex items-center justify-center cursor-help"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t("roadmapGoogleWorkspace")}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span
                        title="Planned"
                        className="w-4 h-4 rounded-full bg-muted-foreground/30 shrink-0 flex items-center justify-center cursor-help"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t("roadmapMessagingIntegration")}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span
                        title="Planned"
                        className="w-4 h-4 rounded-full bg-muted-foreground/30 shrink-0 flex items-center justify-center cursor-help"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t("roadmapScheduledTasks")}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span
                        title="Planned"
                        className="w-4 h-4 rounded-full bg-muted-foreground/30 shrink-0 flex items-center justify-center cursor-help"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t("roadmapSkills")}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <span
                        title="Planned"
                        className="w-4 h-4 rounded-full bg-muted-foreground/30 shrink-0 flex items-center justify-center cursor-help"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t("roadmapModelSwitching")}
                      </span>
                    </li>
                  </ul>
                  <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-green-500 shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        Done
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-info shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        In Progress
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        Designed
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-muted-foreground/30 shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        Planned
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </ScrollArea>

      <CreateChannelDialog
        isOpen={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
      />
    </main>
  );
}
