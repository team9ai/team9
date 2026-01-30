import { Bot, Sparkles, Map, Wrench } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
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

export function HomeMainContent() {
  const workspaceId = useSelectedWorkspaceId();
  const { data: workspaces } = useUserWorkspaces();
  const currentWorkspace = workspaces?.find((w) => w.id === workspaceId);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const { directChannels = [] } = useChannelsByType();
  const { data: invitations = [] } = useWorkspaceInvitations(
    workspaceId ?? undefined,
  );
  const createInvitation = useCreateInvitation(workspaceId ?? undefined);
  const hasCreatedRef = useRef(false);

  // 找到一个可用的邀请链接：isActive、未过期、未达到使用上限
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

  // 没有可用邀请时自动创建一个
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
          <div className="mb-10">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">
              欢迎回到 {workspaceName}!
            </h1>
            <p className="text-slate-500 text-base">以下是你的工作空间动态。</p>
          </div>

          {/* Two Column Layout */}
          <div className="flex gap-8">
            {/* Left Column */}
            <div className="w-72 shrink-0 flex flex-col gap-6">
              {/* 本周的开发路线图 */}
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Map size={16} className="text-blue-600" />
                    </div>
                    <h3 className="font-semibold text-base">
                      本周的开发路线图
                    </h3>
                  </div>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-2" />
                      <span className="text-sm text-slate-700">
                        支持操作本地环境
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-2" />
                      <span className="text-sm text-slate-700">
                        新增一系列高频工具
                      </span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              {/* 支持的工具列表 */}
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                      <Wrench size={16} className="text-amber-600" />
                    </div>
                    <h3 className="font-semibold text-base">支持的工具列表</h3>
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
              {/* 和 Clawdbot 开始聊天 */}
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <h3 className="font-semibold text-base mb-4 text-center">
                    和 Clawdbot 开始聊天
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
                      className="bg-blue-600 hover:bg-blue-700 rounded-lg px-6"
                      onClick={handleStartChatWithBot}
                    >
                      Start Chatting
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* 邀请你的好友加入 workspace */}
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 text-center">
                  <h3 className="font-semibold text-base mb-4">
                    邀请你的好友加入 workspace
                  </h3>
                  <div className="bg-slate-100 rounded-lg px-4 py-2.5 mb-4">
                    <span className="text-sm font-mono text-slate-700 truncate block">
                      {inviteUrl ?? "加载中..."}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 rounded-lg px-6"
                    disabled={!inviteUrl}
                    onClick={handleCopyLink}
                  >
                    {copied ? "已复制" : "复制链接"}
                  </Button>
                </CardContent>
              </Card>

              {/* 创建你的第一个频道 */}
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 text-center flex flex-col items-center justify-center h-full">
                  <h3 className="font-semibold text-base mb-5">
                    创建你的第一个频道并且邀请
                    <br />
                    Clawdbot 一起协同
                  </h3>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 rounded-lg px-6"
                  >
                    创建频道
                  </Button>
                </CardContent>
              </Card>

              {/* 加入早期内测用户反馈 */}
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 text-center">
                  <h3 className="font-semibold text-base mb-4">
                    加入早期内测用户反馈
                  </h3>
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mx-auto mb-3">
                    <Bot size={28} className="text-blue-600" />
                  </div>
                  <p className="text-sm font-medium text-slate-600">
                    Team9 Support Bot
                  </p>
                </CardContent>
              </Card>

              {/* 创建你的第一个 AI Staff */}
              <Card className="col-span-2 border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                      <Sparkles size={20} className="text-violet-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-base">
                        创建你的第一个 AI Staff
                      </h3>
                      <p className="text-sm text-slate-500">
                        使用 AI 助手提升团队协作效率
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 rounded-lg px-6"
                  >
                    创建 AI Staff
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </ScrollArea>
    </main>
  );
}
