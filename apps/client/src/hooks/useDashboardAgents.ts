import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  BaseModelStaffBotInfo,
  CommonStaffBotInfo,
  InstalledApplicationWithBots,
  OpenClawBotInfo,
  PersonalStaffListBotInfo,
} from "@/services/api/applications";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import type { AgentType, ChannelWithUnread } from "@/types/im";
import { useCurrentUser } from "./useAuth";

export interface DashboardAgentModel {
  provider: string;
  id: string;
}

type DashboardBot =
  | OpenClawBotInfo
  | BaseModelStaffBotInfo
  | CommonStaffBotInfo
  | PersonalStaffListBotInfo;

export interface DashboardAgent {
  userId: string;
  botId?: string;
  channelId?: string;
  label: string;
  username?: string;
  avatarUrl?: string | null;
  agentType: AgentType | null;
  applicationId: string;
  installedApplicationId?: string;
  hasExistingChannel: boolean;
  model: DashboardAgentModel | null;
  managedAgentId: string | null;
  canSwitchModel: boolean;
  staffKind: "common" | "personal" | "other" | null;
  roleTitle: string | null;
  ownerName: string | null;
}

function isPersonalStaffBot(
  bot: DashboardBot,
): bot is PersonalStaffListBotInfo {
  return "ownerId" in bot && "visibility" in bot;
}

function getBotAvatarUrl(bot: DashboardBot): string | null {
  return "avatarUrl" in bot ? (bot.avatarUrl ?? null) : null;
}

function getBotAgentType(bot: DashboardBot): AgentType | null {
  return "agentType" in bot ? (bot.agentType ?? null) : null;
}

function getBotModel(bot: DashboardBot): DashboardAgentModel | null {
  return "model" in bot ? (bot.model ?? null) : null;
}

function getBotManagedAgentId(bot: DashboardBot): string | null {
  return "managedMeta" in bot ? (bot.managedMeta?.agentId ?? null) : null;
}

function canOpenDashboardDm(bot: DashboardBot, currentUserId?: string) {
  if (!isPersonalStaffBot(bot)) return true;

  return bot.ownerId === currentUserId || bot.visibility.allowDirectMessage;
}

function canSwitchDashboardModel(applicationId: string) {
  return applicationId === "common-staff" || applicationId === "personal-staff";
}

function getStaffKind(applicationId: string): DashboardAgent["staffKind"] {
  if (applicationId === "common-staff") return "common";
  if (applicationId === "personal-staff") return "personal";
  if (applicationId === "base-model-staff") return "other";
  return null;
}

function getBotRoleTitle(bot: DashboardBot): string | null {
  return "roleTitle" in bot ? (bot.roleTitle ?? null) : null;
}

function getBotOwnerId(bot: DashboardBot): string | null {
  return "ownerId" in bot ? (bot.ownerId ?? null) : null;
}

function getAgentGroupOrder(agent: DashboardAgent): number {
  if (agent.applicationId === "personal-staff") return 0;
  if (agent.applicationId === "common-staff") return 1;
  if (agent.applicationId === "base-model-staff") return 2;
  if (agent.applicationId === "openclaw") return 3;
  return 4;
}

export function buildDashboardAgents(
  installedApps: InstalledApplicationWithBots[] | undefined,
  directChannels: ChannelWithUnread[] | undefined,
  currentUserId?: string,
  currentUserDisplayName?: string | null,
): DashboardAgent[] {
  const directBotChannels = (directChannels ?? []).filter(
    (channel) =>
      channel.otherUser?.userType === "bot" && !!channel.otherUser?.id,
  );

  const directBotChannelByUserId = new Map(
    directBotChannels.map((channel) => [channel.otherUser!.id, channel]),
  );
  const directBotChannelOrderByUserId = new Map(
    directBotChannels.map((channel, index) => [channel.otherUser!.id, index]),
  );

  const agents = new Map<string, DashboardAgent>();

  for (const app of installedApps ?? []) {
    if (app.status !== "active") continue;

    for (const bot of app.bots) {
      if (
        !bot.userId ||
        !bot.isActive ||
        !canOpenDashboardDm(bot, currentUserId)
      )
        continue;

      const existingChannel = directBotChannelByUserId.get(bot.userId);
      const label = bot.displayName || bot.username || app.name || "AI Staff";
      const staffKind =
        existingChannel?.otherUser?.staffKind ??
        getStaffKind(app.applicationId);
      const ownerId = getBotOwnerId(bot);
      const ownerName =
        existingChannel?.otherUser?.ownerName ??
        (ownerId && ownerId === currentUserId
          ? (currentUserDisplayName ?? null)
          : null);

      agents.set(bot.userId, {
        userId: bot.userId,
        botId: bot.botId,
        channelId: existingChannel?.id,
        label,
        username: bot.username,
        avatarUrl:
          getBotAvatarUrl(bot) ?? existingChannel?.otherUser?.avatarUrl,
        agentType:
          getBotAgentType(bot) ?? existingChannel?.otherUser?.agentType ?? null,
        applicationId: app.applicationId,
        installedApplicationId: app.id,
        hasExistingChannel: !!existingChannel,
        model: getBotModel(bot),
        managedAgentId: getBotManagedAgentId(bot),
        canSwitchModel: canSwitchDashboardModel(app.applicationId),
        staffKind,
        roleTitle:
          getBotRoleTitle(bot) ?? existingChannel?.otherUser?.roleTitle ?? null,
        ownerName,
      });
    }
  }

  for (const channel of directBotChannels) {
    const otherUser = channel.otherUser;

    if (!otherUser?.id || agents.has(otherUser.id)) continue;

    agents.set(otherUser.id, {
      userId: otherUser.id,
      channelId: channel.id,
      label: otherUser.displayName || otherUser.username || "AI Staff",
      username: otherUser.username,
      avatarUrl: otherUser.avatarUrl,
      agentType: otherUser.agentType ?? null,
      applicationId: "direct-channel",
      installedApplicationId: undefined,
      hasExistingChannel: true,
      model: null,
      managedAgentId: null,
      canSwitchModel: false,
      staffKind: otherUser.staffKind ?? null,
      roleTitle: otherUser.roleTitle ?? null,
      ownerName: otherUser.ownerName ?? null,
    });
  }

  return Array.from(agents.values()).sort((left, right) => {
    const groupDiff = getAgentGroupOrder(left) - getAgentGroupOrder(right);
    if (groupDiff !== 0) return groupDiff;

    const leftChannelOrder = directBotChannelOrderByUserId.get(left.userId);
    const rightChannelOrder = directBotChannelOrderByUserId.get(right.userId);

    if (leftChannelOrder !== undefined && rightChannelOrder !== undefined) {
      return leftChannelOrder - rightChannelOrder;
    }
    if (leftChannelOrder !== undefined) return -1;
    if (rightChannelOrder !== undefined) return 1;

    return left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    });
  });
}

export function useDashboardAgents(
  directChannels: ChannelWithUnread[] | undefined,
) {
  const workspaceId = useSelectedWorkspaceId();
  const { data: currentUser } = useCurrentUser();

  const { data: installedApps, isLoading } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId],
    queryFn: () => api.applications.getInstalledApplicationsWithBots(),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  const agents = useMemo(
    () =>
      buildDashboardAgents(
        installedApps,
        directChannels,
        currentUser?.id,
        currentUser?.displayName ?? currentUser?.username ?? null,
      ),
    [
      currentUser?.id,
      currentUser?.displayName,
      currentUser?.username,
      directChannels,
      installedApps,
    ],
  );

  return {
    agents,
    isLoading,
  };
}
