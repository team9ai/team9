import type { KeyboardEvent, MouseEvent } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, SquarePen } from "lucide-react";
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
  /** Grouped data from `useAgentGroupsForSidebar()`. */
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
 * Sidebar section that renders one collapsible block per agent.
 *
 * Layout is intentionally kept flat and high-contrast:
 *   - header row: 32px tall, shows expand chevron + avatar + agent name,
 *     with a hover-revealed "+" button for quick "new topic"
 *   - child rows: 28px tall, indented under a thin left border,
 *     showing the topic title (no leading icon to keep scanning easy)
 *   - legacy DM tail row (if any): same 28px but italic + dim so it
 *     reads as "this is the older persistent conversation"
 *
 * Header click behaviour (product decision D4):
 *   - Toggles the group's expanded state.
 *   - If a legacy direct channel exists, also navigates to it — that
 *     channel is treated as the agent's default / historical surface.
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
    <div className="space-y-px">
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

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleHeaderClick();
    }
  };

  const handleNewTopic = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // Send the user back to the dashboard composer. The dashboard
    // remembers the last-selected agent in its own state, so the user
    // lands with sensible defaults and can type the new prompt.
    void navigate({ to: "/channels" });
  };

  return (
    <div>
      {/* Using a div instead of a Button so the inner "+" button is
          allowed (nested native <button> elements are invalid HTML and
          caused the older design to render with odd focus/active
          states). keyboard accessibility is preserved manually. */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
        className={cn(
          "group flex items-center gap-2 h-8 px-2 rounded-md cursor-pointer select-none",
          "text-sm font-medium text-nav-foreground-strong",
          "hover:bg-nav-hover",
          headerHighlighted &&
            "bg-nav-active text-nav-foreground-strong hover:bg-nav-active",
        )}
      >
        <span className="shrink-0 inline-flex w-4 items-center justify-center text-nav-foreground-subtle">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
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
        <button
          type="button"
          onClick={handleNewTopic}
          title={t("newTopic", {
            ns: "navigation" as const,
            defaultValue: "新建话题",
          })}
          aria-label={t("newTopic", {
            ns: "navigation" as const,
            defaultValue: "新建话题",
          })}
          className={cn(
            "shrink-0 inline-flex size-6 items-center justify-center rounded",
            "text-nav-foreground-subtle transition-colors",
            "hover:text-nav-foreground-strong hover:bg-nav-hover",
          )}
        >
          <SquarePen size={14} />
        </button>
      </div>

      {expanded && (
        <div className="ml-[14px] mt-0.5 mb-1 space-y-px border-l border-nav-border/60 pl-2">
          {group.recentSessions.length === 0 ? (
            <p className="text-[0.7rem] italic text-nav-foreground-faint px-2 py-1">
              {t("topicSessionsEmpty", {
                ns: "navigation" as const,
                defaultValue: "暂无话题",
              })}
            </p>
          ) : (
            group.recentSessions.map((s) => (
              <TopicSessionRow
                key={s.channelId}
                channelId={s.channelId}
                title={s.title}
                unreadCount={s.unreadCount}
                isSelected={s.channelId === selectedChannelId}
                linkPrefix={linkPrefix}
                fallbackLabel={t("topicSessionUntitled", {
                  ns: "navigation" as const,
                  defaultValue: "(未命名话题)",
                })}
              />
            ))
          )}
          {/* NOTE: no row for legacyDirectChannelId — clicking the
              agent header already routes to it (per product decision
              D4). An extra "Direct Messages" child row was showing up
              here and overlapping semantically with the sibling
              "Direct Messages" section below, causing confusion. */}
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
  const isUntitled = !title?.trim();

  return (
    <button
      type="button"
      onClick={() => navigateToChannel(navigate, linkPrefix, channelId)}
      className={cn(
        "flex w-full items-center gap-2 h-7 px-2 rounded-md text-left text-[0.8rem]",
        "text-nav-foreground hover:bg-nav-hover hover:text-nav-foreground-strong",
        isUntitled && "text-nav-foreground-faint italic",
        isSelected &&
          "bg-nav-active text-nav-foreground-strong not-italic hover:bg-nav-active",
      )}
    >
      <span className="truncate flex-1">{label}</span>
      {unreadCount > 0 ? (
        <span className="ml-auto shrink-0 rounded-full bg-[#2f67ff] px-1.5 py-0.5 text-[0.6rem] font-semibold leading-none text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </button>
  );
}
