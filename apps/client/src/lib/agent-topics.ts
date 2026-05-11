import type { useNavigate } from "@tanstack/react-router";

/**
 * Navigate to the dashboard composer with the given agent pre-selected, so the
 * user can start a fresh topic-session with that agent. Shared by the sidebar
 * agent-group "+" button and the in-chat header "new topic" button so both
 * stay in sync.
 */
export function navigateToNewTopic(
  navigate: ReturnType<typeof useNavigate>,
  agentUserId: string,
): void {
  void navigate({ to: "/channels", search: { agentId: agentUserId } });
}
