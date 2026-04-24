export interface TopicSessionResponse {
  channelId: string;
  sessionId: string;
  agentId: string;
  botUserId: string;
  title: string | null;
  createdAt: string;
}

export interface TopicSessionRecentEntry {
  channelId: string;
  sessionId: string;
  title: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
}

export interface TopicSessionGroup {
  /** Bot shadow userId in team9.users */
  agentUserId: string;
  /** agent-pi agent id (from bots.managedMeta.agentId) */
  agentId: string;
  agentDisplayName: string;
  agentAvatarUrl: string | null;
  /**
   * The existing `type='direct'` channel between the user and this agent,
   * if one was established before the topic-session feature rolled out.
   * Kept so the sidebar can keep the pre-feature conversation accessible
   * as the agent group's "historical DM".
   */
  legacyDirectChannelId: string | null;
  /** Total topic-session channels the user has with this agent. */
  totalCount: number;
  /** Most-recent-first, capped at `perAgent` from the query. */
  recentSessions: TopicSessionRecentEntry[];
}
