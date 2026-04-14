import { useState, useRef, useCallback, useMemo, type DragEvent } from "react";
import {
  MessageSquare,
  File,
  Plus,
  Table,
  Kanban,
  Calendar,
  Pencil,
  Trash2,
  X,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  useChannelTabs,
  useCreateTab,
  useDeleteTab,
  useUpdateTab,
  useReorderTabs,
} from "@/hooks/useChannelTabs";
import { useChannelViews, useCreateView } from "@/hooks/useChannelViews";
import type { ChannelTab } from "@/types/properties";
import type { ViewType } from "@/types/properties";

// ==================== Constants ====================

const VIEW_TYPE_OPTIONS: {
  value: ViewType;
  label: string;
  icon: typeof Table;
}[] = [
  { value: "table", label: "Table", icon: Table },
  { value: "board", label: "Board", icon: Kanban },
  { value: "calendar", label: "Calendar", icon: Calendar },
];

/** Determine icon from view.type when available, falling back to tab.type */
function getTabIcon(tab: ChannelTab, viewType?: string) {
  // Builtin tabs
  if (tab.type === "messages") return MessageSquare;
  if (tab.type === "files") return File;

  // View tabs: prefer actual view.type over the tab.type naming convention
  const resolvedType = viewType ?? tab.type;
  if (resolvedType === "table" || resolvedType === "table_view") return Table;
  if (resolvedType === "board" || resolvedType === "board_view") return Kanban;
  if (resolvedType === "calendar" || resolvedType === "calendar_view")
    return Calendar;
  return Table;
}

// ==================== Props ====================

interface ChannelTabsProps {
  channelId: string;
  activeTabId: string;
  onTabChange: (tabId: string) => void;
}

// ==================== Sub-components ====================

interface TabItemProps {
  tab: ChannelTab;
  isActive: boolean;
  viewType?: string;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  isDraggable: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
}

function TabItem({
  tab,
  isActive,
  viewType,
  onClick,
  onRename,
  onDelete,
  isDraggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: TabItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const Icon = getTabIcon(tab, viewType);

  const startEditing = useCallback(() => {
    setEditName(tab.name);
    setIsEditing(true);
    // Focus after render
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [tab.name]);

  const commitRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== tab.name) {
      onRename(trimmed);
    }
    setIsEditing(false);
  }, [editName, tab.name, onRename]);

  const cancelEditing = useCallback(() => {
    setEditName(tab.name);
    setIsEditing(false);
  }, [tab.name]);

  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      onDragOver?.(e);
      setDragOver(true);
    },
    [onDragOver],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      onDragLeave?.(e);
      setDragOver(false);
    },
    [onDragLeave],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      onDrop?.(e);
      setDragOver(false);
    },
    [onDrop],
  );

  const tabContent = (
    <div
      className={cn(
        "relative pt-1",
        dragOver &&
          "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-primary before:rounded-full",
      )}
      draggable={isDraggable && !isEditing}
      onDragStart={onDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={onDragEnd}
    >
      <button
        onClick={isEditing ? undefined : onClick}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 text-[13px] font-medium whitespace-nowrap transition-colors rounded-t-md hover:bg-foreground/5",
          isActive
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
          isDraggable && !isEditing && "cursor-grab active:cursor-grabbing",
        )}
      >
        <Icon size={13} />
        {isEditing ? (
          <span
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              ref={inputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") cancelEditing();
              }}
              onBlur={commitRename}
              className="h-5 w-24 px-1 py-0 text-sm"
            />
          </span>
        ) : (
          <span>{tab.name}</span>
        )}
      </button>
      {isActive && (
        <span className="pointer-events-none absolute left-0 right-0 -bottom-px h-[3px] bg-primary" />
      )}
    </div>
  );

  // Builtin tabs don't get a context menu
  if (tab.isBuiltin) {
    return tabContent;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tabContent}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={startEditing}>
          <Pencil size={14} className="mr-2" />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 size={14} className="mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ==================== Create Tab Popover ====================

interface CreateTabPopoverProps {
  channelId: string;
  onCreated?: (tabId: string) => void;
}

function CreateTabPopover({ channelId, onCreated }: CreateTabPopoverProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [viewType, setViewType] = useState<ViewType>("table");
  const createView = useCreateView(channelId);
  const createTab = useCreateTab(channelId);
  const isSubmitting = createView.isPending || createTab.isPending;

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      // First create the view, then create a tab pointing to it
      const view = await createView.mutateAsync({
        name: trimmed,
        type: viewType,
      });
      const tabType = `${viewType}_view` as
        | "table_view"
        | "board_view"
        | "calendar_view";
      const tab = await createTab.mutateAsync({
        name: trimmed,
        type: tabType,
        viewId: view.id,
      });
      setName("");
      setViewType("table");
      setOpen(false);
      onCreated?.(tab.id);
    } catch {
      // Error handled by mutation hooks
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors ml-0.5"
          title="Add view tab"
        >
          <Plus size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="space-y-3">
          <p className="text-sm font-medium">New View Tab</p>
          <Input
            placeholder="Tab name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isSubmitting) handleCreate();
            }}
            autoFocus
          />
          <Select
            value={viewType}
            onValueChange={(v) => setViewType(v as ViewType)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIEW_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center gap-2">
                    <opt.icon size={14} />
                    {opt.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              <X size={14} className="mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!name.trim() || isSubmitting}
            >
              <Check size={14} className="mr-1" />
              Create
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ==================== Main Component ====================

export function ChannelTabs({
  channelId,
  activeTabId,
  onTabChange,
}: ChannelTabsProps) {
  const { data: tabs = [] } = useChannelTabs(channelId);
  const { data: views = [] } = useChannelViews(channelId);
  const updateTab = useUpdateTab(channelId);
  const deleteTab = useDeleteTab(channelId);
  const reorderTabs = useReorderTabs(channelId);

  const sortedTabs = [...tabs].sort((a, b) => a.order - b.order);

  // Drag-to-reorder state
  const dragTabId = useRef<string | null>(null);

  const handleDragStart = useCallback((tabId: string, e: DragEvent) => {
    dragTabId.current = tabId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tabId);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (targetTabId: string, e: DragEvent) => {
      e.preventDefault();
      const sourceId = dragTabId.current;
      if (!sourceId || sourceId === targetTabId) return;

      // Only reorder non-builtin tabs
      const sourceTab = sortedTabs.find((t) => t.id === sourceId);
      const targetTab = sortedTabs.find((t) => t.id === targetTabId);
      if (!sourceTab || sourceTab.isBuiltin) return;
      if (!targetTab || targetTab.isBuiltin) return;

      // Compute new order: builtin tabs stay, then reorder custom tabs
      const builtinIds = sortedTabs.filter((t) => t.isBuiltin).map((t) => t.id);
      const customIds = sortedTabs.filter((t) => !t.isBuiltin).map((t) => t.id);

      const fromIdx = customIds.indexOf(sourceId);
      const toIdx = customIds.indexOf(targetTabId);
      if (fromIdx === -1 || toIdx === -1) return;

      customIds.splice(fromIdx, 1);
      customIds.splice(toIdx, 0, sourceId);

      reorderTabs.mutate([...builtinIds, ...customIds]);
      dragTabId.current = null;
    },
    [sortedTabs, reorderTabs],
  );

  const handleDragEnd = useCallback(() => {
    dragTabId.current = null;
  }, []);

  // Build a map from viewId to view.type for icon resolution
  const viewTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const view of views) {
      map.set(view.id, view.type);
    }
    return map;
  }, [views]);

  const handleRename = useCallback(
    (tabId: string, name: string) => {
      updateTab.mutate({ tabId, data: { name } });
    },
    [updateTab],
  );

  const handleDelete = useCallback(
    (tabId: string) => {
      deleteTab.mutate(tabId, {
        onSuccess: () => {
          if (tabId === activeTabId && sortedTabs.length > 1) {
            const fallback = sortedTabs.find((t) => t.id !== tabId);
            if (fallback) onTabChange(fallback.id);
          }
        },
      });
    },
    [activeTabId, sortedTabs, onTabChange, deleteTab],
  );

  return (
    <div className="flex items-center gap-1 px-3 border-b overflow-x-auto scrollbar-none">
      {sortedTabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          viewType={tab.viewId ? viewTypeMap.get(tab.viewId) : undefined}
          onClick={() => onTabChange(tab.id)}
          onRename={(name) => handleRename(tab.id, name)}
          onDelete={() => handleDelete(tab.id)}
          isDraggable={!tab.isBuiltin}
          onDragStart={(e) => handleDragStart(tab.id, e)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(tab.id, e)}
          onDragEnd={handleDragEnd}
        />
      ))}
      <CreateTabPopover channelId={channelId} onCreated={onTabChange} />
    </div>
  );
}
