import {
  Sparkles,
  Map,
  Wrench,
  Bot,
  UserPlus,
  Hash,
  MessageSquare,
} from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
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
import { useSelectedWorkspaceId } from "@/stores";
import { useChannelsByType } from "@/hooks/useChannels";
import { CreateChannelDialog } from "@/components/dialog/CreateChannelDialog";

export function HomeMainContent() {
  const { t } = useTranslation(["navigation", "common"]);
  const workspaceId = useSelectedWorkspaceId();
  const { data: workspaces } = useUserWorkspaces();
  const currentWorkspace = workspaces?.find((w) => w.id === workspaceId);
  const [copied, setCopied] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const navigate = useNavigate();
  const { directChannels = [] } = useChannelsByType();
  const { data: invitations = [] } = useWorkspaceInvitations(
    workspaceId ?? undefined,
  );
  const createInvitation = useCreateInvitation(workspaceId ?? undefined);
  const hasCreatedRef = useRef(false);

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

  useEffect(() => {
    if (validInvitation || hasCreatedRef.current || !workspaceId) return;
    hasCreatedRef.current = true;
    createInvitation.mutate({
      role: "member",
      maxUses: 1000,
      expiresInDays: 100,
    });
  }, [validInvitation, workspaceId]);

  const inviteUrl = validInvitation?.url;

  const handleStartChatWithBot = () => {
    const botChannel = directChannels.find(
      (ch) => ch.otherUser?.username === "moltbot",
    );
    if (botChannel) {
      navigate({
        to: "/channels/$channelId",
        params: { channelId: botChannel.id },
      });
    }
  };

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
          {/* Welcome Section */}
          <div className="mb-10 flex items-center gap-6">
            <img
              src="/whale.webp"
              alt="Team9 Mascot"
              loading="lazy"
              width={80}
              height={80}
              className="w-20 h-20  object-cover shadow-md shrink-0"
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

          {/* Two Column Layout */}
          <div className="flex gap-8">
            {/* Left Column */}
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
                    {[
                      { name: "X API", status: "soon" },
                      { name: "Nano Banana Pro", status: "soon" },
                      { name: "Web Search API", status: "soon" },
                      { name: "Stock API", status: "soon" },
                      { name: "Youtube Reader", status: "soon" },
                      { name: "Jina Link Reader", status: "soon" },
                      { name: "Veo 3.1", status: "soon" },
                      { name: "Eleven Labs API", status: "soon" },
                      { name: "Minimax Audio", status: "soon" },
                      { name: "Kling", status: "soon" },
                      { name: "Deep Research", status: "soon" },
                      { name: "Semrush API", status: "soon" },
                      { name: "Suno API", status: "soon" },
                      { name: "ChatGPT", status: "soon" },
                      { name: "Gemini", status: "soon" },
                      { name: "Claude Code", status: "soon" },
                    ].map((tool, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted"
                      >
                        <span className="text-sm text-foreground">
                          {tool.name}
                        </span>
                        <span className="text-xs text-muted-foreground bg-border px-2 py-0.5 rounded-full">
                          {tool.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column */}
            <div className="flex-1 grid grid-cols-2 gap-6 auto-rows-min">
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
                      <Bot size={16} className="text-info" />
                    </div>
                    <h3 className="font-semibold text-base">
                      {t("chatWithClawdbot")}
                    </h3>
                  </div>
                  <div className="flex items-center justify-center gap-3 mb-4">
                    <img
                      src="/bot.webp"
                      alt="Clawdbot"
                      className="w-11 h-11 rounded-full shadow-sm shrink-0"
                    />
                    <div className="relative border border-border rounded-xl px-3.5 py-2 text-sm text-muted-foreground bg-background shadow-sm">
                      HI its Clawdbot here!
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
                      <Hash size={16} className="text-primary" />
                    </div>
                    <h3 className="font-semibold text-base">
                      {t("navigation:createFirstChannel")}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t("navigation:createChannelDescription")}
                  </p>
                  <div className="mt-auto text-center">
                    <Button
                      size="sm"
                      className="bg-info hover:bg-info/90 text-primary-foreground rounded-lg px-6 cursor-pointer"
                      onClick={() => setIsCreateChannelOpen(true)}
                    >
                      {t("navigation:createChannel")}
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
                        window.open("https://discord.gg/edMATqpU", "_blank")
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
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <li className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-info shrink-0 mt-2" />
                      <span className="text-sm text-foreground">
                        {t("roadmapCreateAIStaff")}
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-info shrink-0 mt-2" />
                      <span className="text-sm text-foreground">
                        {t("roadmapAIStaffOnComputer")}
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-info shrink-0 mt-2" />
                      <span className="text-sm text-foreground">
                        {t("roadmapBigToolUpdate")}
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-info shrink-0 mt-2" />
                      <span className="text-sm text-foreground">
                        {t("roadmapNewUI")}
                      </span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              {/* <Card className="col-span-2 border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Sparkles size={20} className="text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-base">
                        {t("navigation:createFirstAIStaff")}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {t("navigation:aiStaffDescription")}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-info hover:bg-info/90 text-primary-foreground rounded-lg px-6 cursor-pointer"
                  >
                    {t("navigation:createAIStaff")}
                  </Button>
                </CardContent>
              </Card> */}
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
