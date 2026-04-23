import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import type { TopicSessionGroup } from "@/services/api/im";

type LinkPrefix = "/channels" | "/messages";

/**
 * Navigate to a channel under either the `/channels` or `/messages`
 * parent route. TanStack Router requires the `to` value to be a
 * literal string (not a template), so we dispatch between the two
 * routes here with explicit literals.
 */
function navigateToChannel(
  navigate: ReturnType<typeof useNavigate>,
  linkPrefix: LinkPrefix,
  channelId: string,
) {
  if (linkPrefix === "/channels") {
    void navigate({
      to: "/channels/$channelId",
      params: { channelId },
    });
  } else {
    void navigate({
      to: "/messages/$channelId",
      params: { channelId },
    });
  }
}

export interface AgentGroupListProps {
  /** Grouped data from `useTopicSessionsGrouped()`. */
  groups: TopicSessionGroup[];
  /** Currently-open channel id, used to highlight the matching row. */
  selectedChannelId?: string;
  /** Route prefix for `navigate` — the two sidebars render under different
   *  parent routes but otherwise share the same agent grouping UI. */
  linkPrefix: LinkPrefix;
  /** True while the grouped query is loading *and* we have no cached data. */
  isLoading?: boolean;
  /** Optional: initially-expanded agent id (e.g. the one matching the
   *  currently-open channel). When omitted, all groups start collapsed. */
  initiallyExpandedAgentUserId?: string | null;
}

/**
 * Sidebar section that renders one collapsible block per agent, each
 * containing the caller's most-recent topic sessions with that agent plus
 * an optional "legacy DM" tail row.
 *
 * Header click behaviour (per product decision D4):
 *  - Toggles the group's expanded state.
 *  - If a legacy direct channel exists, also navigates to it — that channel
 *    is treated as the agent's "default / historical" conversation surface.
 *
 * Child rows link straight to the topic-session channel.
 */
export function AgentGroupList({
  groups,
  selectedChannelId,
  linkPrefix,
  isLoading,
  initiallyExpandedAgentUserId,
}: AgentGroupListProps) {
  const { t } = useTranslation(["navigation", "common", "message"]);

  // Auto-expand the group whose child channel (topic or legacy DM) is
  // currently selected, so the user can orient when they land on a
  // channel directly via URL.
  const autoExpandedAgentUserId = useMemo(() => {
    if (!selectedChannelId) return initiallyExpandedAgentUserId ?? null;
    for (const g of groups) {
      if (g.legacyDirectChannelId === selectedChannelId) return g.agentUserId;
      if (g.recentSessions.some((s) => s.channelId === selectedChannelId))
        return g.agentUserId;
    }
    return initiallyExpandedAgentUserId ?? null;
  }, [groups, selectedChannelId, initiallyExpandedAgentUserId]);

  if (isLoading && groups.length === 0) {
    return (
      <p className="text-xs text-nav-foreground-faint px-2 py-1">
        {t("common:loading")}
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="text-xs text-nav-foreground-faint px-2 py-1">
        {t("message:noMessages")}
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      {groups.map((group) => (
        <AgentGroup
          key={group.agentUserId}
          group={group}
          selectedChannelId={selectedChannelId}
          linkPrefix={linkPrefix}
          defaultExpanded={group.agentUserId === autoExpandedAgentUserId}
        />
      ))}
    </div>
  );
}

function AgentGroup({
  group,
  selectedChannelId,
  linkPrefix,
  defaultExpanded,
}: {
  group: TopicSessionGroup;
  selectedChannelId?: string;
  linkPrefix: LinkPrefix;
  defaultExpanded: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation(["navigation"]);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const headerHighlighted =
    !!group.legacyDirectChannelId &&
    selectedChannelId === group.legacyDirectChannelId;

  const handleHeaderClick = () => {
    setExpanded((prev) => !prev);
    // D4: header click also opens the legacy DM if one exists, so the
    // agent-group header doubles as "entrance to the agent's persistent
    // conversation". No legacy → header is just a collapser.
    if (group.legacyDirectChannelId) {
      navigateToChannel(navigate, linkPrefix, group.legacyDirectChannelId);
    }
  };

  const handleNewTopic = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // Send the user back to the dashboard composer. The dashboard
    // remembers the last-selected agent in its own state, so the user
    // lands with sensible defaults and can type the new prompt.
    void navigate({ to: "/channels" });
  };

  return (
    <div>
      <Button
        variant="ghost"
        onClick={handleHeaderClick}
        className={cn(
          "w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm",
          headerHighlighted &&
            "bg-nav-active text-nav-foreground hover:bg-nav-active",
        )}
      >
        {expanded ? (
          <ChevronDown size={14} className="shrink-0" />
        ) : (
          <ChevronRight size={14} className="shrink-0" />
        )}
        <UserAvatar
          userId={group.agentUserId}
          name={group.agentDisplayName}
          avatarUrl={group.agentAvatarUrl}
          isBot
          className="size-5 shrink-0"
          fallbackClassName="text-[0.58rem] font-semibold"
        />
        <span className="truncate flex-1 text-left">
          {group.agentDisplayName}
        </span>
        <Button
          asChild={false}
          variant="ghost"
          size="icon"
          onClick={handleNewTopic}
          title={t("newMessage")}
          className="h-6 w-6 opacity-60 hover:opacity-100"
        >
          <Plus size={12} />
        </Button>
      </Button>

      {expanded && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-nav-border pl-2">
          {group.recentSessions.length === 0 && !group.legacyDirectChannelId ? (
            <p className="text-[0.7rem] text-nav-foreground-faint px-2 py-1">
              {t("noMessages", {
                ns: "message" as const,
                defaultValue: "No conversations yet",
              })}
            </p>
          ) : null}

          {group.recentSessions.map((s) => (
            <TopicSessionRow
              key={s.channelId}
              channelId={s.channelId}
              title={s.title}
              unreadCount={s.unreadCount}
              isSelected={s.channelId === selectedChannelId}
              linkPrefix={linkPrefix}
              fallbackLabel={t("noMessages", {
                ns: "message" as const,
                defaultValue: "Untitled topic",
              })}
            />
          ))}

          {group.legacyDirectChannelId &&
          group.legacyDirectChannelId !== selectedChannelId ? (
            <LegacyDirectChannelRow
              channelId={group.legacyDirectChannelId}
              isSelected={group.legacyDirectChannelId === selectedChannelId}
              linkPrefix={linkPrefix}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function TopicSessionRow({
  channelId,
  title,
  unreadCount,
  isSelected,
  linkPrefix,
  fallbackLabel,
}: {
  channelId: string;
  title: string | null;
  unreadCount: number;
  isSelected: boolean;
  linkPrefix: LinkPrefix;
  fallbackLabel: string;
}) {
  const navigate = useNavigate();
  const label = title?.trim() || fallbackLabel;

  return (
    <Button
      variant="ghost"
      onClick={() => navigateToChannel(navigate, linkPrefix, channelId)}
      className={cn(
        "w-full justify-start gap-2 px-2 h-auto py-1 text-[0.8rem]",
        isSelected && "bg-nav-active text-nav-foreground hover:bg-nav-active",
      )}
    >
      <MessageSquare size={12} className="shrink-0 text-nav-foreground-faint" />
      <span className="truncate flex-1 text-left">{label}</span>
      {unreadCount > 0 ? (
        <span className="ml-auto shrink-0 rounded-full bg-[#2f67ff] px-1.5 text-[0.6rem] font-semibold text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Button>
  );
}

function LegacyDirectChannelRow({
  channelId,
  isSelected,
  linkPrefix,
}: {
  channelId: string;
  isSelected: boolean;
  linkPrefix: LinkPrefix;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation(["navigation"]);

  return (
    <Button
      variant="ghost"
      onClick={() => navigateToChannel(navigate, linkPrefix, channelId)}
      className={cn(
        "w-full justify-start gap-2 px-2 h-auto py-1 text-[0.75rem] text-nav-foreground-faint italic",
        isSelected && "bg-nav-active text-nav-foreground hover:bg-nav-active",
      )}
    >
      <MessageSquare size={11} className="shrink-0" />
      <span className="truncate flex-1 text-left">
        {t("directMessages", { defaultValue: "Direct message" })}
      </span>
    </Button>
  );
}
