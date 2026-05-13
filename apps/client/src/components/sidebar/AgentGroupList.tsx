import type { KeyboardEvent, MouseEvent } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  MoreHorizontal,
  SquarePen,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { navigateToNewTopic } from "@/lib/agent-topics";
import type { TopicSessionGroup } from "@/services/api/im";

type LinkPrefix = "/channels" | "/messages";
type TopicSessionActionHandler = (channelId: string) => void | Promise<void>;

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

function navigateToList(
  navigate: ReturnType<typeof useNavigate>,
  linkPrefix: LinkPrefix,
) {
  if (linkPrefix === "/channels") {
    void navigate({ to: "/channels" });
  } else {
    void navigate({ to: "/messages" });
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
  /** Called when an expanded group has more topic sessions than currently loaded. */
  onLoadMoreTopicSessions?: (agentUserId: string) => void;
  /** True while a larger topic-session page is being fetched. */
  isLoadingMoreTopicSessions?: boolean;
  /** Archive a topic-session channel from the row menu. */
  onArchiveTopicSession?: TopicSessionActionHandler;
  /** Permanently delete a topic-session channel after confirmation. */
  onDeleteTopicSession?: TopicSessionActionHandler;
  /** True while any topic-session archive/delete mutation is in flight. */
  isTopicSessionActionPending?: boolean;
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
  onLoadMoreTopicSessions,
  isLoadingMoreTopicSessions,
  onArchiveTopicSession,
  onDeleteTopicSession,
  isTopicSessionActionPending,
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
          onLoadMoreTopicSessions={onLoadMoreTopicSessions}
          isLoadingMoreTopicSessions={isLoadingMoreTopicSessions}
          onArchiveTopicSession={onArchiveTopicSession}
          onDeleteTopicSession={onDeleteTopicSession}
          isTopicSessionActionPending={isTopicSessionActionPending}
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
  onLoadMoreTopicSessions,
  isLoadingMoreTopicSessions,
  onArchiveTopicSession,
  onDeleteTopicSession,
  isTopicSessionActionPending,
}: {
  group: TopicSessionGroup;
  selectedChannelId?: string;
  linkPrefix: LinkPrefix;
  defaultExpanded: boolean;
  onLoadMoreTopicSessions?: (agentUserId: string) => void;
  isLoadingMoreTopicSessions?: boolean;
  onArchiveTopicSession?: TopicSessionActionHandler;
  onDeleteTopicSession?: TopicSessionActionHandler;
  isTopicSessionActionPending?: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation(["navigation", "common"]);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const headerHighlighted =
    !!group.legacyDirectChannelId &&
    selectedChannelId === group.legacyDirectChannelId;
  const hiddenTopicCount = Math.max(
    0,
    group.totalCount - group.recentSessions.length,
  );
  const shouldShowLoadMore = hiddenTopicCount > 0 && !!onLoadMoreTopicSessions;

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
    // Route back to the dashboard composer with the clicked agent pre-selected
    // via search param, so the composer header reflects the correct agent
    // instead of falling back to the dashboard's last-remembered selection.
    navigateToNewTopic(navigate, group.agentUserId);
  };

  const handleLoadMore = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onLoadMoreTopicSessions?.(group.agentUserId);
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
          "group relative flex items-center gap-2 h-8 px-2 rounded-md cursor-pointer select-none",
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
          showAiBadge
          className="size-5 shrink-0"
          fallbackClassName="text-[0.58rem] font-semibold"
        />
        <span className="min-w-0 flex flex-1 items-baseline gap-1.5 text-left">
          <span className="min-w-0 truncate">{group.agentDisplayName}</span>
          {group.agentSubtitle && (
            <span
              className={cn(
                "ml-auto shrink-0 max-w-[5.5rem] truncate text-[0.68rem] font-normal text-nav-foreground-muted",
                "transition-[margin] group-hover:mr-6 group-focus-within:mr-6",
                (expanded || headerHighlighted) && "mr-6",
              )}
              title={group.agentSubtitle}
            >
              {group.agentSubtitle}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={handleNewTopic}
          title={t("newTopic", { ns: "navigation" as const })}
          aria-label={t("newTopic", { ns: "navigation" as const })}
          className={cn(
            "absolute right-2 shrink-0 inline-flex size-5 items-center justify-center rounded",
            "text-nav-foreground-subtle transition-opacity",
            "hover:text-nav-foreground-strong hover:bg-nav-hover",
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            (expanded || headerHighlighted) && "opacity-100",
          )}
        >
          <SquarePen size={12} />
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
                onArchiveTopicSession={onArchiveTopicSession}
                onDeleteTopicSession={onDeleteTopicSession}
                isActionPending={isTopicSessionActionPending}
                fallbackLabel={t("topicSessionUntitled", {
                  ns: "navigation" as const,
                  defaultValue: "(未命名话题)",
                })}
              />
            ))
          )}
          {shouldShowLoadMore && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={isLoadingMoreTopicSessions}
              aria-label={t("loadMoreTopicSessions", {
                ns: "navigation" as const,
                defaultValue: "More",
              })}
              className={cn(
                "flex w-full items-center gap-1.5 h-7 px-2 rounded-md text-left text-[0.75rem]",
                "text-nav-foreground-muted hover:bg-nav-hover hover:text-nav-foreground-strong",
                "disabled:pointer-events-none disabled:opacity-60",
              )}
            >
              <Ellipsis size={14} className="shrink-0" />
              <span className="truncate">
                {isLoadingMoreTopicSessions
                  ? t("loadingMore", {
                      ns: "common" as const,
                      defaultValue: "Loading...",
                    })
                  : t("loadMoreTopicSessions", {
                      ns: "navigation" as const,
                      defaultValue: "More",
                    })}
              </span>
            </button>
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
  onArchiveTopicSession,
  onDeleteTopicSession,
  isActionPending,
  fallbackLabel,
}: {
  channelId: string;
  title: string | null;
  unreadCount: number;
  isSelected: boolean;
  linkPrefix: LinkPrefix;
  onArchiveTopicSession?: TopicSessionActionHandler;
  onDeleteTopicSession?: TopicSessionActionHandler;
  isActionPending?: boolean;
  fallbackLabel: string;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation(["navigation", "common"]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [localPendingAction, setLocalPendingAction] = useState<
    "archive" | "delete" | null
  >(null);
  const label = title?.trim() || fallbackLabel;
  const isUntitled = !title?.trim();
  const hasActions = !!onArchiveTopicSession || !!onDeleteTopicSession;
  const isPending = !!isActionPending || localPendingAction !== null;

  const archiveLabel = t("archiveTopicSession", {
    ns: "navigation" as const,
    defaultValue: "Archive",
  });
  const deleteLabel = t("deleteTopicSession", {
    ns: "navigation" as const,
    defaultValue: "Delete",
  });

  const handleOpenChannel = () =>
    navigateToChannel(navigate, linkPrefix, channelId);

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleOpenChannel();
    }
  };

  const navigateAwayIfSelected = () => {
    if (isSelected) {
      navigateToList(navigate, linkPrefix);
    }
  };

  const handleArchive = async () => {
    if (!onArchiveTopicSession || isPending) return;
    setLocalPendingAction("archive");
    try {
      await onArchiveTopicSession(channelId);
      navigateAwayIfSelected();
    } catch (error) {
      console.error("Failed to archive topic session:", error);
    } finally {
      setLocalPendingAction(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!onDeleteTopicSession || isPending) return;
    setLocalPendingAction("delete");
    try {
      await onDeleteTopicSession(channelId);
      setDeleteDialogOpen(false);
      navigateAwayIfSelected();
    } catch (error) {
      console.error("Failed to delete topic session:", error);
    } finally {
      setLocalPendingAction(null);
    }
  };

  const row = (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={handleOpenChannel}
      onKeyDown={handleRowKeyDown}
      className={cn(
        "group/topic relative flex w-full items-center gap-2 h-7 px-2 rounded-md text-left text-[0.8rem]",
        hasActions && "pr-8",
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
      {hasActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("topicSessionActions", {
                ns: "navigation" as const,
                title: label,
                defaultValue: `${label} actions`,
              })}
              disabled={isPending}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className={cn(
                "absolute right-1.5 inline-flex size-5 items-center justify-center rounded",
                "text-nav-foreground-subtle transition-opacity",
                "hover:bg-nav-hover hover:text-nav-foreground-strong",
                "opacity-0 group-hover/topic:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                isSelected && "opacity-100",
                isPending && "pointer-events-none opacity-60",
              )}
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {onArchiveTopicSession && (
              <DropdownMenuItem
                disabled={isPending}
                onSelect={() => void handleArchive()}
              >
                <Archive size={14} />
                {localPendingAction === "archive"
                  ? t("archivingTopicSession", {
                      ns: "navigation" as const,
                      defaultValue: "Archiving...",
                    })
                  : archiveLabel}
              </DropdownMenuItem>
            )}
            {onDeleteTopicSession && (
              <DropdownMenuItem
                disabled={isPending}
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                onSelect={() => setDeleteDialogOpen(true)}
              >
                <Trash2 size={14} />
                {deleteLabel}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  const content = hasActions ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-36">
        {onArchiveTopicSession && (
          <ContextMenuItem
            disabled={isPending}
            className="gap-2"
            onSelect={() => void handleArchive()}
          >
            <Archive size={14} />
            {archiveLabel}
          </ContextMenuItem>
        )}
        {onDeleteTopicSession && (
          <ContextMenuItem
            disabled={isPending}
            className="gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
            onSelect={() => setDeleteDialogOpen(true)}
          >
            <Trash2 size={14} />
            {deleteLabel}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  ) : (
    row
  );

  return (
    <>
      {content}
      {onDeleteTopicSession && (
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent className="max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("deleteTopicSessionTitle", {
                  ns: "navigation" as const,
                  defaultValue: "Delete topic?",
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("deleteTopicSessionDescription", {
                  ns: "navigation" as const,
                  title: label,
                  defaultValue:
                    "This permanently removes this topic and its messages. This cannot be undone.",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>
                {t("common:cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  event.preventDefault();
                  void handleConfirmDelete();
                }}
              >
                {localPendingAction === "delete"
                  ? t("deletingTopicSession", {
                      ns: "navigation" as const,
                      defaultValue: "Deleting...",
                    })
                  : t("deleteTopicSessionConfirm", {
                      ns: "navigation" as const,
                      defaultValue: "Delete topic",
                    })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
