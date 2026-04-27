import { describe, expect, it } from "vitest";
import type { InstalledApplicationWithBots } from "@/services/api/applications";
import type { ChannelWithUnread } from "@/types/im";
import { buildDashboardAgents } from "../useDashboardAgents";

function makeInstalledApp(
  overrides: Partial<InstalledApplicationWithBots>,
): InstalledApplicationWithBots {
  return {
    id: "app-1",
    applicationId: "openclaw",
    name: "AI Staff",
    description: "",
    tenantId: "tenant-1",
    config: {},
    permissions: {},
    status: "active",
    isActive: true,
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
    bots: [],
    instanceStatus: null,
    ...overrides,
  };
}

function makeDirectBotChannel(
  overrides: Partial<ChannelWithUnread>,
): ChannelWithUnread {
  return {
    id: "channel-1",
    tenantId: "tenant-1",
    name: "DM",
    type: "direct",
    createdBy: "user-1",
    order: 0,
    isArchived: false,
    isActivated: true,
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
    unreadCount: 0,
    otherUser: {
      id: "bot-user-1",
      username: "bot_one",
      displayName: "Bot One",
      status: "online",
      userType: "bot",
      agentType: "openclaw",
    },
    ...overrides,
  };
}

describe("buildDashboardAgents", () => {
  it("merges installed bots with existing bot DMs and filters unavailable agents", () => {
    const installedApps = [
      makeInstalledApp({
        id: "openclaw-app",
        applicationId: "openclaw",
        name: "OpenClaw",
        bots: [
          {
            botId: "bot-open",
            userId: "bot-user-open",
            agentType: "openclaw",
            agentId: "agent-open",
            workspace: "workspace-a",
            username: "open_agent",
            displayName: "Open Agent",
            isActive: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            mentorId: null,
            mentorDisplayName: null,
            mentorAvatarUrl: null,
          },
        ],
      }),
      makeInstalledApp({
        id: "personal-app",
        applicationId: "personal-staff",
        name: "Personal Staff",
        bots: [
          {
            botId: "bot-private",
            userId: "bot-user-private",
            username: "private_staff",
            displayName: "Private Staff",
            avatarUrl: null,
            ownerId: "other-user",
            persona: null,
            model: null,
            visibility: {
              allowMention: true,
              allowDirectMessage: false,
            },
            isActive: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            managedMeta: { agentId: "personal-1" },
          },
          {
            botId: "bot-mine",
            userId: "bot-user-mine",
            username: "my_staff",
            displayName: "My Staff",
            avatarUrl: null,
            ownerId: "me",
            persona: null,
            model: null,
            visibility: {
              allowMention: false,
              allowDirectMessage: false,
            },
            isActive: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            managedMeta: { agentId: "personal-2" },
          },
        ],
      }),
      makeInstalledApp({
        id: "inactive-app",
        applicationId: "openclaw",
        status: "inactive",
        bots: [
          {
            botId: "bot-inactive",
            userId: "bot-user-inactive",
            agentType: "openclaw",
            agentId: "agent-inactive",
            workspace: "workspace-b",
            username: "inactive_agent",
            displayName: "Inactive Agent",
            isActive: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            mentorId: null,
            mentorDisplayName: null,
            mentorAvatarUrl: null,
          },
        ],
      }),
    ] as InstalledApplicationWithBots[];

    const directChannels = [
      makeDirectBotChannel({
        id: "channel-existing",
        otherUser: {
          id: "bot-user-existing",
          username: "existing_agent",
          displayName: "Existing Agent",
          status: "online",
          userType: "bot",
          agentType: "openclaw",
        },
      }),
      makeDirectBotChannel({
        id: "channel-open",
        otherUser: {
          id: "bot-user-open",
          username: "open_agent",
          displayName: "Open Agent",
          status: "online",
          userType: "bot",
          agentType: "openclaw",
        },
      }),
    ];

    const agents = buildDashboardAgents(installedApps, directChannels, "me");

    // Sort order: personal-staff (0) → openclaw (3) → direct-channel (4)
    expect(agents.map((agent) => agent.userId)).toEqual([
      "bot-user-mine",
      "bot-user-open",
      "bot-user-existing",
    ]);
    expect(agents[0]).toMatchObject({
      channelId: undefined,
      applicationId: "personal-staff",
      label: "My Staff",
      hasExistingChannel: false,
    });
    expect(agents[1]).toMatchObject({
      channelId: "channel-open",
      applicationId: "openclaw",
      label: "Open Agent",
      hasExistingChannel: true,
    });
  });
});
