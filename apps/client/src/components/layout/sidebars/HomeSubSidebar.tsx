import {
  ChevronDown,
  ChevronRight,
  Hash,
  Lock,
  Headphones,
  BookOpen,
  UserPlus,
  Plus,
  FolderPlus,
  Trash2,
  Download,
  EyeOff,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import React, { useState, useEffect, useMemo } from "react";
import {
  useChannelsByType,
  usePublicChannels,
  useSetSidebarVisibility,
} from "@/hooks/useChannels";
import { useTopicSessionsGrouped } from "@/hooks/useTopicSessions";
import { AgentGroupList } from "@/components/sidebar/AgentGroupList";
import {
  useSections,
  useMoveChannel,
  useDeleteSection,
} from "@/hooks/useSections";
import { useUserWorkspaces } from "@/hooks/useWorkspace";
import { useSelectedWorkspaceId } from "@/stores";
import { Link, useParams } from "@tanstack/react-router";
import { NewMessageDialog } from "@/components/dialog/NewMessageDialog";
import { CreateChannelDialog } from "@/components/dialog/CreateChannelDialog";
import { CreateSectionDialog } from "@/components/dialog/CreateSectionDialog";
import { InviteManagementDialog } from "@/components/workspace/InviteManagementDialog";
import { UserListItem } from "@/components/sidebar/UserListItem";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  DragEndEvent,
  DragStartEvent,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import type { Channel, ChannelWithUnread } from "@/types/im";
import { isTauriApp } from "@/lib/tauri";

function isMacBrowser(): boolean {
  return !isTauriApp() && /Mac/.test(navigator.userAgent);
}

function detectMacArch(): "arm64" | "x64" {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) {
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      if (/Apple/.test(renderer)) return "arm64";
    }
  } catch {
    // fallback below
  }
  return "x64";
}

const GITHUB_RELEASES_API =
  "https://api.github.com/repos/team9ai/team9/releases/latest";
const GITHUB_RELEASES_PAGE = "https://github.com/team9ai/team9/releases/latest";

const topItems: {
  id: string;
  label: string;
  icon: typeof Headphones;
}[] = [
  { id: "dashboard", label: "Dashboard", icon: BookOpen },
  { id: "invite", label: "Invite Your Team", icon: UserPlus },
];

// Draggable Channel Component
function DraggableChannel({
  channel,
  isSelected,
  isDragging,
  canDrag = true,
}: {
  channel: ChannelWithUnread;
  isSelected: boolean;
  isDragging: boolean;
  canDrag?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: channel.id,
    disabled: !canDrag,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const ChannelIcon = channel.type === "private" ? Lock : Hash;
  const isMember = "isMember" in channel ? channel.isMember : true;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(canDrag ? listeners : {})}
      className={cn("touch-none", isDragging && "opacity-50")}
    >
      <Link
        to="/channels/$channelId"
        params={{ channelId: channel.id }}
        className="block min-w-0"
        draggable={false}
      >
        <Button
          variant="ghost"
          className={cn(
            "w-full min-w-0 justify-start gap-2 px-2 h-auto py-1.5 text-sm hover:bg-nav-hover hover:text-nav-foreground",
            isMember
              ? "text-nav-foreground-muted"
              : "text-nav-foreground-faint italic",
            isSelected && "bg-nav-active",
          )}
        >
          <ChannelIcon
            size={16}
            className={cn("shrink-0", !isMember && "opacity-50")}
          />
          <span className="truncate text-left max-w-35" title={channel.name}>
            {channel.name}
          </span>
          {channel.unreadCount > 0 && (
            <Badge
              variant="notification"
              size="sm"
              count={channel.unreadCount}
            />
          )}
        </Button>
      </Link>
    </div>
  );
}

// Droppable area component (just a drop target container)
function DroppableArea({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded",
        isOver && "bg-nav-overlay-bg ring-1 ring-nav-ring",
        className,
      )}
    >
      {children}
    </div>
  );
}

// Drag Overlay Content Component
function DragOverlayContent({ channel }: { channel: Channel }) {
  const ChannelIcon = channel.type === "private" ? Lock : Hash;

  return (
    <div className="bg-nav-sub-bg border border-nav-border-strong rounded shadow-lg">
      <Button
        variant="ghost"
        className="w-full min-w-0 justify-start gap-2 px-2 h-auto py-1.5 text-sm text-nav-foreground-muted pointer-events-none"
      >
        <ChannelIcon size={16} className="shrink-0" />
        <span className="truncate text-left" title={channel.name}>
          {channel.name}
        </span>
      </Button>
    </div>
  );
}

function DownloadDesktopButton() {
  const { t: tNav } = useTranslation("navigation");
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(GITHUB_RELEASES_API);
      if (!res.ok) throw new Error("Failed to fetch release");
      const release = await res.json();
      const arch = detectMacArch();
      const dmg = release.assets?.find(
        (a: { name: string }) =>
          a.name.endsWith(".dmg") && a.name.includes(`_${arch}`),
      );
      if (dmg) {
        const a = document.createElement("a");
        a.href = dmg.browser_download_url;
        a.download = dmg.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.open(GITHUB_RELEASES_PAGE, "_blank");
      }
    } catch {
      window.open(GITHUB_RELEASES_PAGE, "_blank");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      onClick={handleDownload}
      disabled={downloading}
      className="w-full justify-center gap-2 px-2 h-10 text-sm text-nav-foreground-strong hover:bg-nav-hover hover:text-nav-foreground rounded-full border border-nav-border-strong"
    >
      <Download size={16} />
      <span>{downloading ? tNav("downloading") : tNav("downloadDesktop")}</span>
    </Button>
  );
}

export function HomeSubSidebar() {
  const { t: tNav } = useTranslation("navigation");
  const { t: tCommon } = useTranslation("common");
  const { t: tChannel } = useTranslation("channel");
  const { t: tMessage } = useTranslation("message");
  const workspaceId = useSelectedWorkspaceId();
  const { data: workspaces } = useUserWorkspaces();
  const currentWorkspace = workspaces?.find((w) => w.id === workspaceId);

  const [channelsExpanded, setChannelsExpanded] = useState(true);
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [dmsExpanded, setDmsExpanded] = useState(true);
  const [appsExpanded, setAppsExpanded] = useState(true);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [createChannelSectionId, setCreateChannelSectionId] = useState<
    string | null
  >(null);
  const [isCreateSectionOpen, setIsCreateSectionOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(),
  );
  const [sectionsInitialized, setSectionsInitialized] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const {
    publicChannels: myPublicChannels = [],
    privateChannels = [],
    directChannels = [],
    isLoading,
  } = useChannelsByType();
  const { data: allPublicChannels = [], isLoading: isLoadingPublic } =
    usePublicChannels();
  const { data: agentGroups = [], isLoading: isLoadingAgents } =
    useTopicSessionsGrouped(5);
  const setSidebarVisibility = useSetSidebarVisibility();
  const { data: sections = [] } = useSections();
  const moveChannel = useMoveChannel();
  const deleteSection = useDeleteSection();
  const params = useParams({ strict: false });
  const selectedChannelId = (params as { channelId?: string }).channelId;

  // Default all sections to expanded when first loaded
  useEffect(() => {
    if (!sectionsInitialized && sections.length > 0) {
      setExpandedSections(new Set(sections.map((s) => s.id)));
      setSectionsInitialized(true);
    }
  }, [sections, sectionsInitialized]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const toggleSectionExpanded = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const channelId = active.id as string;
    const overId = over.id as string;

    // Determine the target section
    let targetSectionId: string | null = null;

    if (overId === "unsectioned") {
      // Dropped in the unsectioned area
      targetSectionId = null;
    } else if (overId.startsWith("section-")) {
      // Dropped on a section header
      targetSectionId = overId.replace("section-", "");
    } else {
      // Dropped on another channel - find which section that channel belongs to
      const targetChannel = allChannels.find((ch) => ch.id === overId);
      if (targetChannel) {
        targetSectionId = targetChannel.sectionId ?? null;
      } else {
        return; // Invalid drop target
      }
    }

    // Move the channel to the target section
    moveChannel.mutate({
      channelId,
      data: { sectionId: targetSectionId, order: 0 },
    });
  };

  // Merge my public channels (with unread counts) with all public channels
  // Show all public channels, but use the unreadCount from myPublicChannels if available
  const publicChannelsWithStatus = useMemo(
    () =>
      allPublicChannels.map((channel) => {
        const myChannel = myPublicChannels.find((ch) => ch.id === channel.id);
        return {
          ...channel,
          unreadCount: myChannel?.unreadCount || 0,
        };
      }),
    [allPublicChannels, myPublicChannels],
  );

  const allChannels = useMemo(
    () => [...publicChannelsWithStatus, ...privateChannels],
    [publicChannelsWithStatus, privateChannels],
  );

  // Group channels by section
  const channelsBySection = useMemo(() => {
    const grouped: Record<string, typeof allChannels> = {
      unsectioned: [],
    };

    allChannels.forEach((channel) => {
      const sectionId = channel.sectionId ?? "unsectioned";
      if (!grouped[sectionId]) {
        grouped[sectionId] = [];
      }
      grouped[sectionId].push(channel);
    });

    return grouped;
  }, [allChannels]);

  // Extract users from direct channels. Bots are rendered under the
  // "AI Agents" grouping further down (via AgentGroupList), so the
  // flat DM list shows only human-to-human conversations here to avoid
  // duplicating each agent in two places.
  const directMessageUsers = directChannels
    .filter((channel) => channel.otherUser?.userType !== "bot")
    .map((channel) => {
      const otherUser = channel.otherUser;
      const displayName =
        otherUser?.displayName || otherUser?.username || "Direct Message";

      return {
        id: channel.id,
        channelId: channel.id,
        userId: otherUser?.id,
        name: displayName,
        avatarUrl: otherUser?.avatarUrl,
        agentType: otherUser?.agentType,
        staffKind: otherUser?.staffKind ?? null,
        roleTitle: otherUser?.roleTitle ?? null,
        ownerName: otherUser?.ownerName ?? null,
        status: otherUser?.status || ("offline" as const),
        unreadCount: channel.unreadCount || 0,
        isBot: otherUser?.userType === "bot",
      };
    });

  return (
    <aside className="w-64 h-full overflow-hidden bg-nav-sub-bg text-primary-foreground flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2">
        <Button
          variant="ghost"
          className="w-full justify-between text-nav-foreground hover:bg-nav-hover px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">
            {currentWorkspace?.name || "Workspace"}
          </span>
          <ChevronDown size={16} className="text-nav-foreground-subtle" />
        </Button>
      </div>

      <Separator className="bg-nav-border" />

      {/* Content Items */}
      <ScrollArea className="flex-1 min-h-0 px-3 [&>[data-slot=scroll-area-viewport]>div]:block!">
        <nav className="space-y-0.5 pb-3 pt-2">
          {/* Top-level navigation items */}
          {topItems.map((item) => {
            const Icon = item.icon;
            if (item.id === "invite") {
              return (
                <div key={item.id}>
                  <Button
                    variant="ghost"
                    onClick={() => setIsInviteDialogOpen(true)}
                    className="w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm text-nav-foreground-muted hover:bg-nav-hover hover:text-nav-foreground"
                  >
                    <Icon size={16} />
                    <span className="truncate">{item.label}</span>
                  </Button>
                </div>
              );
            }
            return (
              <div key={item.id}>
                <Link to="/channels" className="block">
                  <Button
                    variant="ghost"
                    className={cn(
                      "w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm text-nav-foreground-muted hover:bg-nav-hover hover:text-nav-foreground",
                      !selectedChannelId && "bg-nav-active",
                    )}
                  >
                    <Icon size={16} />
                    <span className="truncate">{item.label}</span>
                  </Button>
                </Link>
              </div>
            );
          })}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* Sections as top-level collapsible groups */}
            {sections.map((section) => {
              const sectionChannels = channelsBySection[section.id] || [];
              const isSectionExpanded = expandedSections.has(section.id);
              const isSectionEmpty = sectionChannels.length === 0;

              return (
                <DroppableArea
                  key={section.id}
                  id={`section-${section.id}`}
                  className="mt-4"
                >
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      onClick={() => toggleSectionExpanded(section.id)}
                      className={cn(
                        "flex-1 justify-start gap-1 px-2 h-auto py-1.5 text-sm hover:text-nav-foreground hover:bg-nav-hover",
                        isSectionEmpty
                          ? "text-nav-foreground-dim"
                          : "text-nav-foreground-strong",
                      )}
                    >
                      {isSectionExpanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <span className="truncate">{section.name}</span>
                    </Button>
                    <AlertDialog>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-nav-foreground-subtle hover:text-nav-foreground hover:bg-nav-hover focus-visible:ring-0 focus-visible:ring-offset-0"
                          >
                            <Plus size={14} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            onClick={() => {
                              setCreateChannelSectionId(section.id);
                              setIsCreateChannelOpen(true);
                            }}
                          >
                            <Hash size={16} className="mr-2" />
                            {tNav("createChannel")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setIsCreateSectionOpen(true)}
                          >
                            <FolderPlus size={16} className="mr-2" />
                            {tNav("createSection")}
                          </DropdownMenuItem>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem className="text-destructive focus:text-destructive">
                              <Trash2 size={16} className="mr-2" />
                              {tNav("deleteSection")}
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {tNav("deleteSection")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {tNav("deleteSectionConfirm", {
                              name: section.name,
                            })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>
                            {tNav("cancel")}
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteSection.mutate(section.id)}
                          >
                            {tNav("deleteSection")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  {isSectionExpanded && !isSectionEmpty && (
                    <div className="ml-2 mt-1 space-y-0.5">
                      {sectionChannels.length === 0 &&
                      (isLoading || isLoadingPublic) ? (
                        <p className="text-xs text-nav-foreground-faint px-2 py-1">
                          {tCommon("loading")}
                        </p>
                      ) : (
                        sectionChannels.map((channel) => (
                          <DraggableChannel
                            key={channel.id}
                            channel={channel}
                            isSelected={selectedChannelId === channel.id}
                            isDragging={activeId === channel.id}
                            canDrag={true}
                          />
                        ))
                      )}
                    </div>
                  )}
                </DroppableArea>
              );
            })}

            {/* Channels (unsectioned) as top-level collapsible group */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  onClick={() => setChannelsExpanded(!channelsExpanded)}
                  className="flex-1 justify-start gap-1 px-2 h-auto py-1.5 text-sm text-nav-foreground-strong hover:text-nav-foreground hover:bg-nav-hover"
                >
                  {channelsExpanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <span>{tNav("channels")}</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-nav-foreground-subtle hover:text-nav-foreground hover:bg-nav-hover"
                    >
                      <Plus size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem
                      onClick={() => {
                        setCreateChannelSectionId(null);
                        setIsCreateChannelOpen(true);
                      }}
                    >
                      <Hash size={16} className="mr-2" />
                      {tNav("createChannel")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setIsCreateSectionOpen(true)}
                    >
                      <FolderPlus size={16} className="mr-2" />
                      {tNav("createSection")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {channelsExpanded && (
                <div className="ml-2 mt-1">
                  <DroppableArea
                    id="unsectioned"
                    className="space-y-0.5 min-h-8 p-1"
                  >
                    {(channelsBySection.unsectioned?.length ?? 0) === 0 &&
                    (isLoading || isLoadingPublic) ? (
                      <p className="text-xs text-nav-foreground-faint px-2 py-1">
                        {tCommon("loading")}
                      </p>
                    ) : channelsBySection.unsectioned?.length === 0 &&
                      sections.length === 0 ? (
                      <p className="text-xs text-nav-foreground-faint px-2 py-1">
                        {tChannel("noChannels")}
                      </p>
                    ) : (
                      channelsBySection.unsectioned?.map((channel) => (
                        <DraggableChannel
                          key={channel.id}
                          channel={channel}
                          isSelected={selectedChannelId === channel.id}
                          isDragging={activeId === channel.id}
                          canDrag={true}
                        />
                      ))
                    )}
                  </DroppableArea>
                </div>
              )}
            </div>

            <DragOverlay>
              {activeId ? (
                <DragOverlayContent
                  channel={allChannels.find((c) => c.id === activeId)!}
                />
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* AI Agents Section — groups topic sessions per agent; the
              agent-header click opens the legacy direct channel when one
              exists, so no agent conversation is orphaned by the move. */}
          <div className="mt-4">
            <Button
              variant="ghost"
              onClick={() => setAgentsExpanded(!agentsExpanded)}
              className="w-full justify-start gap-1 px-2 h-auto py-1.5 text-sm text-nav-foreground-strong hover:text-nav-foreground hover:bg-nav-hover"
            >
              {agentsExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <span>{tNav("aiAgents", { defaultValue: "AI Agents" })}</span>
            </Button>
            {agentsExpanded && (
              <div className="ml-2 mt-1">
                <AgentGroupList
                  groups={agentGroups}
                  selectedChannelId={selectedChannelId}
                  linkPrefix="/channels"
                  isLoading={isLoadingAgents}
                />
              </div>
            )}
          </div>

          {/* DMs Section */}
          <div className="mt-4">
            <Button
              variant="ghost"
              onClick={() => setDmsExpanded(!dmsExpanded)}
              className="w-full justify-start gap-1 px-2 h-auto py-1.5 text-sm text-nav-foreground-strong hover:text-nav-foreground hover:bg-nav-hover"
            >
              {dmsExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <span>{tNav("directMessages")}</span>
            </Button>
            {dmsExpanded && (
              <div className="ml-2 mt-1 space-y-0.5">
                {directMessageUsers.length === 0 && isLoading ? (
                  <p className="text-xs text-nav-foreground-faint px-2 py-1">
                    {tCommon("loading")}
                  </p>
                ) : directMessageUsers.length === 0 ? (
                  <p className="text-xs text-nav-foreground-faint px-2 py-1">
                    {tMessage("noMessages")}
                  </p>
                ) : (
                  directMessageUsers.map((dm) => (
                    <ContextMenu key={dm.id}>
                      <ContextMenuTrigger className="block w-full">
                        <UserListItem
                          name={dm.name}
                          avatarUrl={dm.avatarUrl}
                          userId={dm.userId}
                          isSelected={selectedChannelId === dm.channelId}
                          unreadCount={dm.unreadCount}
                          channelId={dm.channelId}
                          isBot={dm.isBot}
                          agentType={dm.agentType}
                          staffKind={dm.staffKind}
                          roleTitle={dm.roleTitle}
                          ownerName={dm.ownerName}
                        />
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-48">
                        <ContextMenuItem
                          onClick={() =>
                            setSidebarVisibility.mutate({
                              channelId: dm.channelId,
                              show: false,
                            })
                          }
                        >
                          <EyeOff className="mr-2 h-4 w-4" />
                          {tNav("hideConversation")}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Apps Section */}
          <div className="mt-4">
            <Button
              variant="ghost"
              onClick={() => setAppsExpanded(!appsExpanded)}
              className="w-full justify-start gap-1 px-2 h-auto py-1.5 text-sm text-nav-foreground-strong hover:text-nav-foreground hover:bg-nav-hover"
            >
              {appsExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <span>{tNav("apps")}</span>
            </Button>
          </div>
        </nav>
      </ScrollArea>

      {/* Bottom Action */}
      <div className="p-3 border-t border-nav-border">
        {isTauriApp() ? (
          <Button
            variant="ghost"
            onClick={() => setIsNewMessageOpen(true)}
            className="w-full justify-center gap-2 px-2 h-10 text-sm text-nav-foreground-strong hover:bg-nav-hover hover:text-nav-foreground rounded-full border border-nav-border-strong"
            title={tNav("newMessage")}
          >
            <Plus size={18} />
          </Button>
        ) : (
          isMacBrowser() && <DownloadDesktopButton />
        )}
      </div>

      {/* New Message Dialog */}
      <NewMessageDialog
        isOpen={isNewMessageOpen}
        onClose={() => setIsNewMessageOpen(false)}
      />

      {/* Create Channel Dialog */}
      <CreateChannelDialog
        isOpen={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
        sectionId={createChannelSectionId}
      />

      {/* Create Section Dialog */}
      <CreateSectionDialog
        isOpen={isCreateSectionOpen}
        onClose={() => setIsCreateSectionOpen(false)}
      />

      {/* Invite Management Dialog */}
      {workspaceId && (
        <InviteManagementDialog
          isOpen={isInviteDialogOpen}
          onClose={() => setIsInviteDialogOpen(false)}
          workspaceId={workspaceId}
        />
      )}
    </aside>
  );
}
