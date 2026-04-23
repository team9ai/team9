import { useMemo } from "react";
import type { TopicSessionGroup } from "@/services/api/im";
import { useChannelsByType } from "./useChannels";
import { useDashboardAgents } from "./useDashboardAgents";
import { useTopicSessionsGrouped } from "./useTopicSessions";

/**
 * Sidebar view-model for the "AI Agents" section.
 *
 * Returns one {@link TopicSessionGroup} per *installed* agent in the
 * workspace (directory view) with the user's topic-session activity
 * folded in where present. Contrast:
 *
 *  - `useTopicSessionsGrouped` (server-side `/grouped`) is the
 *    activity view — only agents the user has a topic session or
 *    legacy DM with show up. An agent the user has never talked to
 *    is absent.
 *  - This hook wraps that with `useDashboardAgents` (which is sourced
 *    from `installed-applications-with-bots`) so every installed
 *    agent is discoverable in the sidebar, and the "+" button on each
 *    agent-group header is enough to start a conversation — users
 *    don't have to bounce through Dashboard just to learn an agent
 *    exists.
 *
 * Edge case: if a bot is uninstalled but the user still has a topic
 * session with it, the orphan group is appended so the conversation
 * history is never dropped silently — the user can archive it
 * deliberately instead of losing it on a config change.
 */
export function useAgentGroupsForSidebar(perAgent = 5) {
  const { directChannels = [] } = useChannelsByType();
  const { agents: availableAgents, isLoading: isLoadingAgents } =
    useDashboardAgents(directChannels);
  const { data: activityGroups = [], isLoading: isLoadingActivity } =
    useTopicSessionsGrouped(perAgent);

  const groups = useMemo<TopicSessionGroup[]>(() => {
    const activityByUserId = new Map(
      activityGroups.map((group) => [group.agentUserId, group] as const),
    );
    const merged: TopicSessionGroup[] = [];
    const seen = new Set<string>();

    // 1. Base order: whatever useDashboardAgents decides — today that
    //    means "existing-DM order first, then alphabetical by label"
    //    (see buildDashboardAgents), which matches the legacy sidebar
    //    ordering so users don't see agents reshuffle after this
    //    change.
    for (const agent of availableAgents) {
      seen.add(agent.userId);
      const existing = activityByUserId.get(agent.userId);
      if (existing) {
        // Prefer the install-time display name/avatar from the
        // directory (installed-applications-with-bots is authoritative
        // for the current identity; activityGroups reflects whatever
        // was on the channel member row when the topic was created,
        // which can be stale if the bot was renamed).
        merged.push({
          ...existing,
          agentDisplayName: agent.label,
          agentAvatarUrl: agent.avatarUrl ?? existing.agentAvatarUrl ?? null,
        });
      } else {
        // Installed but no topic session yet — empty placeholder so
        // the agent is still visible. The header "+" button (see
        // AgentGroupList) routes the user back to the Dashboard
        // composer where this agent is selectable.
        merged.push({
          agentUserId: agent.userId,
          agentId: agent.managedAgentId ?? "",
          agentDisplayName: agent.label,
          agentAvatarUrl: agent.avatarUrl ?? null,
          legacyDirectChannelId: agent.channelId ?? null,
          totalCount: 0,
          recentSessions: [],
        });
      }
    }

    // 2. Orphans: topic sessions whose agent is no longer among
    //    installed bots. Append so the user can still reach / delete
    //    them.
    for (const group of activityGroups) {
      if (!seen.has(group.agentUserId)) {
        merged.push(group);
      }
    }

    return merged;
  }, [availableAgents, activityGroups]);

  return {
    groups,
    isLoading: isLoadingAgents || isLoadingActivity,
  };
}
