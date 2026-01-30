import { Sparkles, Map, Wrench } from "lucide-react";
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
    <main className="h-full flex flex-col bg-slate-50 overflow-hidden">
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
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                {t("welcomeBackTo", { workspace: workspaceName })}
              </h1>
              <p className="text-slate-500 text-base">
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
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Map size={16} className="text-blue-600" />
                    </div>
                    <h3 className="font-semibold text-base">
                      {t("weeklyRoadmap")}
                    </h3>
                  </div>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-2" />
                      <span className="text-sm text-slate-700">
                        {t("roadmapLocalEnv")}
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-2" />
                      <span className="text-sm text-slate-700">
                        {t("roadmapNewTools")}
                      </span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                      <Wrench size={16} className="text-amber-600" />
                    </div>
                    <h3 className="font-semibold text-base">
                      {t("supportedTools")}
                    </h3>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { name: "websearch", status: "soon" },
                      { name: "nano Banana pro", status: "soon" },
                      { name: "websearch", status: "soon" },
                      { name: "nano Banana pro", status: "soon" },
                    ].map((tool, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-1.5 px-3 rounded-md bg-slate-50"
                      >
                        <span className="text-sm text-slate-700">
                          {tool.name}
                        </span>
                        <span className="text-xs text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full">
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
                <CardContent className="p-5">
                  <h3 className="font-semibold text-base mb-4 text-center">
                    {t("chatWithClawdbot")}
                  </h3>
                  <div className="flex items-center justify-center gap-3 mb-5">
                    <div className="w-11 h-11 rounded-full bg-linear-to-br from-rose-300 to-rose-400 shadow-sm" />
                    <div className="relative border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-600 bg-white shadow-sm">
                      HI its Clawdbot here!
                      <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rotate-45 border-l border-b border-slate-200 bg-white" />
                    </div>
                  </div>
                  <div className="text-center">
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 rounded-lg px-6 cursor-pointer"
                      onClick={handleStartChatWithBot}
                    >
                      Start Chatting
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 text-center">
                  <h3 className="font-semibold text-base mb-4">
                    {t("inviteFriends")}
                  </h3>
                  <div className="bg-slate-100 rounded-lg px-4 py-2.5 mb-4">
                    <span className="text-sm font-mono text-slate-700 truncate block">
                      {inviteUrl ?? t("common:loading")}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 rounded-lg px-6 cursor-pointer"
                    disabled={!inviteUrl}
                    onClick={handleCopyLink}
                  >
                    {copied ? t("navigation:copied") : t("navigation:copyLink")}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 text-center flex flex-col items-center justify-center h-full">
                  <h3 className="font-semibold text-base mb-5">
                    {t("navigation:createFirstChannel")}
                  </h3>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 rounded-lg px-6 cursor-pointer"
                    onClick={() => setIsCreateChannelOpen(true)}
                  >
                    {t("navigation:createChannel")}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 text-center">
                  <h3 className="font-semibold text-base mb-4">
                    {t("navigation:joinBetaFeedback")}
                  </h3>
                  <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mx-auto mb-3">
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="text-indigo-600"
                    >
                      <path
                        d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.36-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 rounded-lg px-6 cursor-pointer"
                    onClick={() =>
                      window.open("https://discord.gg/edMATqpU", "_blank")
                    }
                  >
                    {t("navigation:joinDiscord")}
                  </Button>
                </CardContent>
              </Card>

              <Card className="col-span-2 border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                      <Sparkles size={20} className="text-violet-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-base">
                        {t("navigation:createFirstAIStaff")}
                      </h3>
                      <p className="text-sm text-slate-500">
                        {t("navigation:aiStaffDescription")}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 rounded-lg px-6 cursor-pointer"
                  >
                    {t("navigation:createAIStaff")}
                  </Button>
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
