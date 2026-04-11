import { useState, useRef, useCallback } from "react";
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
} from "@/hooks/useChannelTabs";
import { useCreateView } from "@/hooks/useChannelViews";
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

function getTabIcon(tab: ChannelTab) {
  if (tab.type === "messages") return MessageSquare;
  if (tab.type === "files") return File;
  if (tab.type === "table_view") return Table;
  if (tab.type === "board_view") return Kanban;
  if (tab.type === "calendar_view") return Calendar;
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
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function TabItem({ tab, isActive, onClick, onRename, onDelete }: TabItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const Icon = getTabIcon(tab);

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

  const tabContent = (
    <button
      onClick={isEditing ? undefined : onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors rounded-t-md border-b-2",
        isActive
          ? "border-primary text-primary bg-primary/5"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
    >
      <Icon size={14} />
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
          className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title="Add view tab"
        >
          <Plus size={16} />
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
  const updateTab = useUpdateTab(channelId);
  const deleteTab = useDeleteTab(channelId);

  const sortedTabs = [...tabs].sort((a, b) => a.order - b.order);

  const handleRename = useCallback(
    (tabId: string, name: string) => {
      updateTab.mutate({ tabId, data: { name } });
    },
    [updateTab],
  );

  const handleDelete = useCallback(
    (tabId: string) => {
      // If deleting the active tab, switch to the first tab
      if (tabId === activeTabId && sortedTabs.length > 1) {
        const fallback = sortedTabs.find((t) => t.id !== tabId);
        if (fallback) onTabChange(fallback.id);
      }
      deleteTab.mutate(tabId);
    },
    [activeTabId, sortedTabs, onTabChange, deleteTab],
  );

  return (
    <div className="flex items-center gap-0.5 px-3 border-b overflow-x-auto scrollbar-none">
      {sortedTabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => onTabChange(tab.id)}
          onRename={(name) => handleRename(tab.id, name)}
          onDelete={() => handleDelete(tab.id)}
        />
      ))}
      <CreateTabPopover channelId={channelId} onCreated={onTabChange} />
    </div>
  );
}
