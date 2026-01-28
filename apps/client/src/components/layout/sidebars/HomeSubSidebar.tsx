import {
  ChevronDown,
  ChevronRight,
  Hash,
  Lock,
  Headphones,
  BookOpen,
  Star,
  Plus,
  FolderPlus,
  MoreVertical,
  Folder,
  GripVertical,
} from "lucide-react";
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
import React, { useState, useMemo } from "react";
import { useChannelsByType, usePublicChannels } from "@/hooks/useChannels";
import { useOnlineUsers } from "@/hooks/useIMUsers";
import { useSections, useMoveChannel } from "@/hooks/useSections";
import { Link, useParams } from "@tanstack/react-router";
import { NewMessageDialog } from "@/components/dialog/NewMessageDialog";
import { CreateChannelDialog } from "@/components/dialog/CreateChannelDialog";
import { CreateSectionDialog } from "@/components/dialog/CreateSectionDialog";
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
import type { Channel } from "@/types/im";
import type { Section } from "@/services/api/im";

const topItems: {
  id: string;
  labelKey: "huddle" | "directory" | "starred";
  icon: typeof Headphones;
  descriptionKey?: "starredDescription";
}[] = [
  { id: "huddle", labelKey: "huddle", icon: Headphones },
  { id: "directory", labelKey: "directory", icon: BookOpen },
  {
    id: "starred",
    labelKey: "starred",
    icon: Star,
    descriptionKey: "starredDescription",
  },
];

// Draggable Channel Component
function DraggableChannel({
  channel,
  isSelected,
  isDragging,
}: {
  channel: Channel;
  isSelected: boolean;
  isDragging: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: channel.id,
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
      className={cn(
        "flex items-center gap-0.5 group",
        isDragging && "opacity-50",
      )}
    >
      {/* Drag Handle - only visible on hover */}
      <div
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing touch-none shrink-0 px-1"
      >
        <GripVertical size={14} className="text-white/40" />
      </div>

      <Link
        to="/channels/$channelId"
        params={{ channelId: channel.id }}
        className="flex-1 min-w-0 block"
      >
        <Button
          variant="ghost"
          className={cn(
            "w-full min-w-0 justify-start gap-2 px-2 h-auto py-1.5 text-sm hover:bg-white/10 hover:text-white",
            isMember ? "text-white/80" : "text-white/50 italic",
            isSelected && "bg-white/10",
          )}
        >
          <ChannelIcon
            size={16}
            className={cn("shrink-0", !isMember && "opacity-50")}
          />
          <span className="truncate text-left" title={channel.name}>
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

// Droppable Section Component
function DroppableSection({
  id,
  section,
  isExpanded,
  onToggle,
  children,
}: {
  id: string;
  section: Section | null;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
  });
  const { t: tNav } = useTranslation("navigation");

  // Check if section is empty
  const isEmpty = React.Children.count(children) === 0;

  // For unsectioned area, just render children without section header
  if (!section) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "space-y-0.5 min-h-8 rounded p-1",
          isOver && "bg-white/5 ring-1 ring-white/20",
        )}
      >
        {children}
      </div>
    );
  }

  // For sections with headers
  return (
    <div className="space-y-0.5">
      <div
        ref={setNodeRef}
        className={cn(
          "rounded transition-colors",
          isOver && "bg-white/5 ring-1 ring-white/20",
        )}
      >
        <Button
          variant="ghost"
          onClick={onToggle}
          className={cn(
            "w-full justify-start gap-1 px-2 h-auto py-1.5 text-xs hover:text-white hover:bg-white/10",
            isEmpty ? "text-white/40" : "text-white/70",
          )}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Folder size={12} />
          <span className="truncate">{section.name}</span>
        </Button>

        {isExpanded && !isEmpty && (
          <div className="ml-4 space-y-0.5 py-1">{children}</div>
        )}
      </div>
    </div>
  );
}

// Drag Overlay Content Component
function DragOverlayContent({ channel }: { channel: Channel }) {
  const ChannelIcon = channel.type === "private" ? Lock : Hash;

  return (
    <div className="bg-[#5b2c6f] border border-white/20 rounded shadow-lg">
      <Button
        variant="ghost"
        className="w-full min-w-0 justify-start gap-2 px-2 h-auto py-1.5 text-sm text-white/80 pointer-events-none"
      >
        <ChannelIcon size={16} className="shrink-0" />
        <span className="truncate text-left" title={channel.name}>
          {channel.name}
        </span>
      </Button>
    </div>
  );
}

export function HomeSubSidebar() {
  const { t: tNav } = useTranslation("navigation");
  const { t: tCommon } = useTranslation("common");
  const { t: tChannel } = useTranslation("channel");
  const { t: tMessage } = useTranslation("message");

  const [channelsExpanded, setChannelsExpanded] = useState(true);
  const [dmsExpanded, setDmsExpanded] = useState(true);
  const [appsExpanded, setAppsExpanded] = useState(true);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isCreateSectionOpen, setIsCreateSectionOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(),
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const {
    publicChannels: myPublicChannels = [],
    privateChannels = [],
    directChannels = [],
    isLoading,
  } = useChannelsByType();
  const { data: allPublicChannels = [], isLoading: isLoadingPublic } =
    usePublicChannels();
  const { data: onlineUsers = {} } = useOnlineUsers();
  const { data: sections = [] } = useSections();
  const moveChannel = useMoveChannel();
  const params = useParams({ strict: false });
  const selectedChannelId = (params as { channelId?: string }).channelId;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
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
      targetSectionId = null;
    } else if (overId.startsWith("section-")) {
      targetSectionId = overId.replace("section-", "");
    } else {
      return; // Invalid drop target
    }

    // Move the channel to the target section
    moveChannel.mutate({
      channelId,
      data: { sectionId: targetSectionId, order: 0 },
    });
  };

  // Merge my public channels (with unread counts) with all public channels
  // Show all public channels, but use the unreadCount from myPublicChannels if available
  const publicChannelsWithStatus = allPublicChannels.map((channel) => {
    const myChannel = myPublicChannels.find((ch) => ch.id === channel.id);
    return {
      ...channel,
      unreadCount: myChannel?.unreadCount || 0,
    };
  });

  const allChannels = [...publicChannelsWithStatus, ...privateChannels];

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
  }, [allChannels, sections]);

  // Extract users from direct channels
  const directMessageUsers = directChannels.map((channel) => {
    // Use the otherUser info from the channel if available
    const otherUser = channel.otherUser;
    const displayName =
      otherUser?.displayName || otherUser?.username || "Direct Message";
    const avatarText =
      otherUser?.displayName?.[0] || otherUser?.username?.[0] || "D";

    return {
      id: channel.id,
      channelId: channel.id,
      userId: otherUser?.id,
      name: displayName,
      avatar: avatarText,
      avatarUrl: otherUser?.avatarUrl,
      status: otherUser?.status || ("offline" as const),
      unreadCount: channel.unreadCount || 0,
    };
  });

  return (
    <aside className="w-64 h-full overflow-hidden bg-[#5b2c6f] text-white flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2">
        <Button
          variant="ghost"
          className="w-full justify-between text-white hover:bg-white/10 px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">Weight Watch</span>
          <ChevronDown size={16} className="text-white/70" />
        </Button>
      </div>

      <Separator className="bg-white/10" />

      {/* Content Items */}
      <ScrollArea className="flex-1 min-h-0 px-3 [&>[data-slot=scroll-area-viewport]>div]:block!">
        <nav className="space-y-0.5 pb-3 pt-2">
          {/* Top-level navigation items */}
          {topItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id}>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2 px-2 h-auto py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <Icon size={16} />
                  <span className="truncate">{tNav(item.labelKey)}</span>
                </Button>
                {item.descriptionKey && (
                  <p className="px-2 text-xs text-white/50 mt-1 mb-2">
                    {tNav(item.descriptionKey)}
                  </p>
                )}
              </div>
            );
          })}

          {/* Channels Section */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={() => setChannelsExpanded(!channelsExpanded)}
                className="flex-1 justify-start gap-1 px-2 h-auto py-1.5 text-sm text-white/90 hover:text-white hover:bg-white/10"
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
                    className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/10"
                  >
                    <MoreVertical size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={() => setIsCreateChannelOpen(true)}
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <div className="ml-2 mt-1 space-y-0.5">
                  {isLoading || isLoadingPublic ? (
                    <p className="text-xs text-white/50 px-2 py-1">
                      {tCommon("loading")}
                    </p>
                  ) : allChannels.length === 0 && sections.length === 0 ? (
                    <p className="text-xs text-white/50 px-2 py-1">
                      {tChannel("noChannels")}
                    </p>
                  ) : (
                    <>
                      {/* Render all sections (always visible, even if empty) */}
                      {sections.map((section) => {
                        const sectionChannels =
                          channelsBySection[section.id] || [];
                        const isSectionExpanded = expandedSections.has(
                          section.id,
                        );

                        return (
                          <DroppableSection
                            key={section.id}
                            id={`section-${section.id}`}
                            section={section}
                            isExpanded={isSectionExpanded}
                            onToggle={() => toggleSectionExpanded(section.id)}
                          >
                            {sectionChannels.map((channel) => (
                              <DraggableChannel
                                key={channel.id}
                                channel={channel}
                                isSelected={selectedChannelId === channel.id}
                                isDragging={activeId === channel.id}
                              />
                            ))}
                          </DroppableSection>
                        );
                      })}

                      {/* Render unsectioned channels with a droppable area */}
                      <DroppableSection
                        id="unsectioned"
                        section={null}
                        isExpanded={true}
                        onToggle={() => {}}
                      >
                        {channelsBySection.unsectioned?.map((channel) => (
                          <DraggableChannel
                            key={channel.id}
                            channel={channel}
                            isSelected={selectedChannelId === channel.id}
                            isDragging={activeId === channel.id}
                          />
                        ))}
                      </DroppableSection>
                    </>
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
            )}
          </div>

          {/* DMs Section */}
          <div className="mt-4">
            <Button
              variant="ghost"
              onClick={() => setDmsExpanded(!dmsExpanded)}
              className="w-full justify-start gap-1 px-2 h-auto py-1.5 text-sm text-white/90 hover:text-white hover:bg-white/10"
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
                {isLoading ? (
                  <p className="text-xs text-white/50 px-2 py-1">
                    {tCommon("loading")}
                  </p>
                ) : directMessageUsers.length === 0 ? (
                  <p className="text-xs text-white/50 px-2 py-1">
                    {tMessage("noMessages")}
                  </p>
                ) : (
                  directMessageUsers.map((dm) => (
                    <UserListItem
                      key={dm.id}
                      name={dm.name}
                      avatar={dm.avatar}
                      avatarUrl={dm.avatarUrl}
                      isOnline={dm.userId ? dm.userId in onlineUsers : false}
                      isSelected={selectedChannelId === dm.channelId}
                      unreadCount={dm.unreadCount}
                      channelId={dm.channelId}
                      avatarSize="sm"
                    />
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
              className="w-full justify-start gap-1 px-2 h-auto py-1.5 text-sm text-white/90 hover:text-white hover:bg-white/10"
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

      {/* Add Button */}
      <div className="p-3 border-t border-white/10">
        <Button
          variant="ghost"
          onClick={() => setIsNewMessageOpen(true)}
          className="w-full justify-center gap-2 px-2 h-10 text-sm text-white/90 hover:bg-white/10 hover:text-white rounded-full border border-white/20"
          title={tNav("newMessage")}
        >
          <Plus size={18} />
        </Button>
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
      />

      {/* Create Section Dialog */}
      <CreateSectionDialog
        isOpen={isCreateSectionOpen}
        onClose={() => setIsCreateSectionOpen(false)}
      />
    </aside>
  );
}
