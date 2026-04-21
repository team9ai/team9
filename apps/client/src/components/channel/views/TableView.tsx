import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Plus,
  ArrowUp,
  ArrowDown,
  GripVertical,
  PanelRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useViewMessagesInfinite } from "@/hooks/useChannelViews";
import { usePropertyDefinitions } from "@/hooks/usePropertyDefinitions";
import { useUpdateView } from "@/hooks/useChannelViews";
import { useSetProperty } from "@/hooks/useMessageProperties";
import { useCurrentUser } from "@/hooks/useAuth";
import { useTreeLoader } from "@/hooks/useTreeLoader";
import { messagesApi } from "@/services/api/im";
import { PropertyValue } from "@/components/channel/properties/PropertyValue";
import { PropertyEditor } from "@/components/channel/properties/PropertyEditor";
import { AiAutoFillButton } from "@/components/channel/properties/AiAutoFillButton";
import { ViewConfigPanel } from "./ViewConfigPanel";
import { TableHierarchyToolbar } from "./TableHierarchyToolbar";
import { cn } from "@/lib/utils";
import type {
  ChannelView,
  PropertyDefinition,
  ViewMessageItem,
  ViewConfig,
  ViewSort,
  ViewSortDirection,
} from "@/types/properties";
import type { TreeNode } from "@/types/relations";

export interface TableViewProps {
  channelId: string;
  view: ChannelView;
  onJumpToMessage?: (messageId: string) => void;
}

// ==================== Tree walking utility ====================

/**
 * Returns visible nodes in DFS order, respecting the expanded set.
 * Collapsed subtrees are excluded entirely (not DOM-hidden).
 */
export function walkVisible(
  allNodes: TreeNode[],
  expandedSet: Set<string>,
): TreeNode[] {
  // Build parent → children map.  Root nodes have effectiveParentId === null.
  const byParent = new Map<string | null, TreeNode[]>();
  for (const n of allNodes) {
    const key = n.effectiveParentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }

  const out: TreeNode[] = [];

  function walk(parentId: string | null) {
    const children = byParent.get(parentId) ?? [];
    for (const n of children) {
      out.push(n);
      // Only recurse into expanded nodes
      if (expandedSet.has(n.messageId)) {
        walk(n.messageId);
      }
    }
  }

  walk(null);
  return out;
}

// ==================== Inline Cell Editor ====================

function CellEditor({
  messageId,
  definition,
  value,
  channelId,
  onClose,
}: {
  messageId: string;
  definition: PropertyDefinition;
  value: unknown;
  channelId: string;
  onClose: () => void;
}) {
  const setProperty = useSetProperty(messageId, channelId);

  const handleChange = useCallback(
    (newValue: unknown) => {
      setProperty.mutate(
        {
          definitionId: definition.id,
          propertyKey: definition.key,
          value: newValue,
        },
        { onSuccess: onClose },
      );
    },
    [setProperty, definition.id, definition.key, onClose],
  );

  // Render inline so editors that normally wrap themselves in a button +
  // Popover (SelectEditor, PersonPicker) don't produce a nested popover
  // inside this cell's outer popover.
  const needsOwnPadding =
    definition.valueType !== "single_select" &&
    definition.valueType !== "multi_select" &&
    definition.valueType !== "tags" &&
    definition.valueType !== "person";

  return (
    <div className={cn("min-w-48", needsOwnPadding && "p-2")}>
      <PropertyEditor
        definition={definition}
        value={value}
        onChange={handleChange}
        disabled={setProperty.isPending}
        inline
        channelId={channelId}
        currentMessageId={messageId}
      />
    </div>
  );
}

// ==================== Table Row ====================

function TableRow({
  message,
  visibleDefs,
  channelId,
  currentUserId,
  columnWidths,
  onJumpToMessage,
}: {
  message: ViewMessageItem;
  visibleDefs: PropertyDefinition[];
  channelId: string;
  currentUserId: string | undefined;
  columnWidths: Record<string, number>;
  onJumpToMessage?: (messageId: string) => void;
}) {
  const { t } = useTranslation("channel");
  const [editingCell, setEditingCell] = useState<string | null>(null);

  const contentPreview = useMemo(() => {
    if (!message.content) return "";
    const text = message.content.replace(/<[^>]+>/g, "");
    return text.length > 80 ? text.slice(0, 80) + "..." : text;
  }, [message.content]);

  return (
    <tr className="group border-b border-border hover:bg-muted/50 transition-colors">
      <td
        className="px-3 py-2 text-sm"
        style={{
          width: columnWidths["__content"] ?? undefined,
          maxWidth: columnWidths["__content"] ?? 320,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="line-clamp-2 flex-1">{contentPreview || "..."}</span>
          {onJumpToMessage && (
            <button
              type="button"
              aria-label={t("table.openInChat")}
              title={t("table.openInChat")}
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 bg-background"
              onClick={(e) => {
                e.stopPropagation();
                onJumpToMessage(message.id);
              }}
            >
              <PanelRight className="h-3 w-3" />
              <span>OPEN</span>
            </button>
          )}
        </div>
      </td>

      {visibleDefs.map((def) => {
        const value = message.properties[def.key];
        const isEditing = editingCell === def.id;
        const canEdit =
          def.valueType !== "text" || message.senderId === currentUserId;

        return (
          <td
            key={def.id}
            className="px-3 py-2 text-sm"
            style={{
              width: columnWidths[def.key] ?? undefined,
            }}
          >
            <Popover
              open={isEditing}
              onOpenChange={(open) => {
                if (!open) setEditingCell(null);
              }}
            >
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "w-full text-left rounded px-1 py-0.5 min-h-[24px] transition-colors",
                    canEdit && "hover:bg-muted cursor-pointer",
                    !canEdit && "cursor-default",
                  )}
                  onClick={() => {
                    if (canEdit) setEditingCell(def.id);
                  }}
                  disabled={!canEdit}
                >
                  {value !== undefined && value !== null ? (
                    <PropertyValue
                      definition={def}
                      value={value}
                      channelId={channelId}
                    />
                  ) : def.key === "title" ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground/50">
                      -
                      <AiAutoFillButton
                        messageId={message.id}
                        channelId={channelId}
                        fields={["title"]}
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      />
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">-</span>
                  )}
                </button>
              </PopoverTrigger>
              {isEditing && (
                <PopoverContent align="start" className="w-auto p-0">
                  <CellEditor
                    messageId={message.id}
                    definition={def}
                    value={value}
                    channelId={channelId}
                    onClose={() => setEditingCell(null)}
                  />
                </PopoverContent>
              )}
            </Popover>
          </td>
        );
      })}
    </tr>
  );
}

// ==================== Hierarchy Table Row ====================

function HierarchyTableRow({
  node,
  visibleDefs,
  channelId,
  currentUserId,
  columnWidths,
  isAncestor,
  isExpanded,
  onExpand,
  onCollapse,
  onJumpToMessage,
}: {
  node: TreeNode;
  visibleDefs: PropertyDefinition[];
  channelId: string;
  currentUserId: string | undefined;
  columnWidths: Record<string, number>;
  isAncestor: boolean;
  isExpanded: boolean;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
  onJumpToMessage?: (messageId: string) => void;
}) {
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const indentPx = node.depth * 16 + 8;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key === "ArrowRight" && node.hasChildren && !isExpanded) {
        e.preventDefault();
        onExpand(node.messageId);
      } else if (e.key === "ArrowLeft" && isExpanded) {
        e.preventDefault();
        onCollapse(node.messageId);
      }
    },
    [node.messageId, node.hasChildren, isExpanded, onExpand, onCollapse],
  );

  return (
    <tr
      tabIndex={0}
      className={cn(
        "group border-b border-border hover:bg-muted/50 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
        isAncestor && "bg-gray-50 border-l-2 border-l-gray-300",
      )}
      onKeyDown={handleKeyDown}
    >
      <td
        className="py-2 text-sm"
        style={{
          paddingLeft: `${indentPx}px`,
          paddingRight: "12px",
          width: columnWidths["__content"] ?? undefined,
          maxWidth: columnWidths["__content"] ?? 320,
        }}
      >
        <div className="flex items-center justify-between gap-2 w-full">
          <span className="inline-flex items-center gap-1 flex-1 min-w-0">
            {node.hasChildren ? (
              <button
                aria-label={isExpanded ? "collapse" : "expand"}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors w-4 text-center"
                onClick={() => {
                  if (isExpanded) {
                    onCollapse(node.messageId);
                  } else {
                    onExpand(node.messageId);
                  }
                }}
              >
                {isExpanded ? "▾" : "▸"}
              </button>
            ) : (
              <span className="inline-block w-4 flex-shrink-0" />
            )}
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {node.messageId}
            </span>
          </span>
          {onJumpToMessage && (
            <button
              type="button"
              aria-label="open in chat"
              title="open in chat"
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 bg-background"
              onClick={(e) => {
                e.stopPropagation();
                onJumpToMessage(node.messageId);
              }}
            >
              <PanelRight className="h-3 w-3" />
              <span>OPEN</span>
            </button>
          )}
        </div>
      </td>

      {visibleDefs.map((def) => {
        // We don't have ViewMessageItem here (only TreeNode with messageId).
        // Render a placeholder for property cells in hierarchy mode.
        const isEditing = editingCell === def.id;
        const canEdit = currentUserId !== undefined;

        return (
          <td
            key={def.id}
            className="px-3 py-2 text-sm"
            style={{
              width: columnWidths[def.key] ?? undefined,
            }}
          >
            <Popover
              open={isEditing}
              onOpenChange={(open) => {
                if (!open) setEditingCell(null);
              }}
            >
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "w-full text-left rounded px-1 py-0.5 min-h-[24px] transition-colors",
                    canEdit && "hover:bg-muted cursor-pointer",
                    !canEdit && "cursor-default",
                  )}
                  onClick={() => {
                    if (canEdit) setEditingCell(def.id);
                  }}
                  disabled={!canEdit}
                >
                  <span className="text-muted-foreground/50">-</span>
                </button>
              </PopoverTrigger>
              {isEditing && (
                <PopoverContent align="start" className="w-auto p-0">
                  <CellEditor
                    messageId={node.messageId}
                    definition={def}
                    value={undefined}
                    channelId={channelId}
                    onClose={() => setEditingCell(null)}
                  />
                </PopoverContent>
              )}
            </Popover>
          </td>
        );
      })}
    </tr>
  );
}

// ==================== New Message Row (T23) ====================

function NewMessageRow({
  channelId,
  colSpan,
}: {
  channelId: string;
  colSpan: number;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [text, setText] = useState("");
  const queryClient = useQueryClient();

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      messagesApi.sendMessage(channelId, { content }),
    onSuccess: () => {
      setText("");
      setIsAdding(false);
      // Invalidate view messages to show the new message
      queryClient.invalidateQueries({
        queryKey: ["channel", channelId, "views"],
        refetchType: "all",
      });
    },
  });

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  }, [text, sendMutation]);

  const handleBlur = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed && !sendMutation.isPending) {
      sendMutation.mutate(trimmed);
    } else if (!trimmed) {
      setIsAdding(false);
    }
  }, [text, sendMutation]);

  if (!isAdding) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-3 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground gap-1"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="h-3 w-3" />
            New message
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            className="h-7 text-xs flex-1"
            placeholder="Type a message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") {
                setText("");
                setIsAdding(false);
              }
            }}
            onBlur={handleBlur}
            disabled={sendMutation.isPending}
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleSubmit}
            disabled={sendMutation.isPending}
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Add"
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setText("");
              setIsAdding(false);
            }}
            disabled={sendMutation.isPending}
          >
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ==================== Sort helpers ====================

function getSortDirection(
  sorts: ViewSort[] | undefined,
  key: string,
): ViewSortDirection | null {
  const found = sorts?.find((s) => s.propertyKey === key);
  return found?.direction ?? null;
}

function cycleSortDirection(
  current: ViewSortDirection | null,
): ViewSortDirection | null {
  if (current === null) return "asc";
  if (current === "asc") return "desc";
  return null;
}

// ==================== Column Header (T24) ====================

function ColumnHeader({
  columnKey,
  label,
  sorts,
  onSortToggle,
  onResizeStart,
  onDragStart,
  onDragOver,
  onDrop,
  width,
}: {
  columnKey: string;
  label: string;
  sorts: ViewSort[] | undefined;
  onSortToggle: (key: string) => void;
  onResizeStart: (key: string, startX: number) => void;
  onDragStart: (key: string) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDrop: (key: string) => void;
  width?: number;
}) {
  const sortDir = getSortDirection(sorts, columnKey);

  return (
    <th
      className="relative px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap select-none group/header"
      style={{ width: width ?? undefined }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart(columnKey);
      }}
      onDragOver={(e) => onDragOver(e, columnKey)}
      onDrop={() => onDrop(columnKey)}
    >
      <button
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => onSortToggle(columnKey)}
      >
        <GripVertical className="h-3 w-3 opacity-0 group-hover/header:opacity-50 cursor-grab" />
        <span>{label}</span>
        {sortDir === "asc" && <ArrowUp className="h-3 w-3" />}
        {sortDir === "desc" && <ArrowDown className="h-3 w-3" />}
      </button>

      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(columnKey, e.clientX);
        }}
      />
    </th>
  );
}

// ==================== Main TableView ====================

export function TableView({
  channelId,
  view,
  onJumpToMessage,
}: TableViewProps) {
  const { data: definitions = [] } = usePropertyDefinitions(channelId);
  const hierarchyMode = !!view.config.hierarchyMode;

  // Flat (non-hierarchy) data
  const {
    data: infiniteData,
    isLoading: flatIsLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useViewMessagesInfinite(channelId, view.id);

  // Hierarchy data (only active when hierarchyMode is on)
  const tree = useTreeLoader({
    channelId,
    viewId: view.id,
    filter: view.config.filters,
    sort: view.config.sorts,
    defaultDepth: view.config.hierarchyDefaultDepth ?? 3,
  });

  const isLoading = hierarchyMode ? tree.isLoading : flatIsLoading;

  const updateView = useUpdateView(channelId);
  const { data: currentUser } = useCurrentUser();

  // Flatten pages into a single messages array (flat mode)
  const messages = useMemo<ViewMessageItem[]>(() => {
    if (!infiniteData?.pages) return [];
    return infiniteData.pages.flatMap((page) => page.messages);
  }, [infiniteData]);

  // Hierarchy mode: ancestor set and visible (DFS-ordered) nodes
  const ancestorSet = useMemo(
    () => new Set(tree.ancestorsIncluded),
    [tree.ancestorsIncluded],
  );
  const visibleNodes = useMemo(
    () => walkVisible(tree.nodes, tree.expandedSet),
    [tree.nodes, tree.expandedSet],
  );

  // Column widths from view config (persisted)
  const columnWidths = useMemo<Record<string, number>>(
    () => view.config.columnWidths ?? {},
    [view.config.columnWidths],
  );

  // Determine visible property columns (ordered by visibleProperties or definition order)
  const visibleDefs = useMemo(() => {
    const visibleKeys = view.config.visibleProperties;
    if (visibleKeys && visibleKeys.length > 0) {
      // Maintain the order from visibleProperties
      return visibleKeys
        .map((key) => definitions.find((d) => d.key === key))
        .filter((d): d is PropertyDefinition => d !== undefined);
    }
    return [...definitions].sort((a, b) => a.order - b.order);
  }, [definitions, view.config.visibleProperties]);

  // ---- T24: Sort toggle ----
  const handleSortToggle = useCallback(
    (key: string) => {
      const currentSorts = view.config.sorts ?? [];
      const currentDir = getSortDirection(currentSorts, key);
      const nextDir = cycleSortDirection(currentDir);

      let newSorts: ViewSort[];
      if (nextDir === null) {
        newSorts = currentSorts.filter((s) => s.propertyKey !== key);
      } else {
        const existing = currentSorts.find((s) => s.propertyKey === key);
        if (existing) {
          newSorts = currentSorts.map((s) =>
            s.propertyKey === key ? { ...s, direction: nextDir } : s,
          );
        } else {
          newSorts = [
            ...currentSorts,
            { propertyKey: key, direction: nextDir },
          ];
        }
      }

      updateView.mutate({
        viewId: view.id,
        data: { config: { ...view.config, sorts: newSorts } },
      });
    },
    [view, updateView],
  );

  // ---- T24: Column resize ----
  const resizeRef = useRef<{
    key: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [localWidths, setLocalWidths] = useState<Record<string, number>>({});
  const handlersRef = useRef<{
    move: (e: MouseEvent) => void;
    up: () => void;
  } | null>(null);

  const effectiveWidths = useMemo(
    () => ({ ...columnWidths, ...localWidths }),
    [columnWidths, localWidths],
  );

  const handleResizeStart = useCallback(
    (key: string, startX: number) => {
      // Remove any existing handlers first
      if (handlersRef.current) {
        document.removeEventListener("mousemove", handlersRef.current.move);
        document.removeEventListener("mouseup", handlersRef.current.up);
      }

      const startWidth = effectiveWidths[key] ?? 150;
      resizeRef.current = { key, startX, startWidth };

      const move = (e: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = e.clientX - resizeRef.current.startX;
        const newWidth = Math.max(60, resizeRef.current.startWidth + delta);
        setLocalWidths((prev) => ({
          ...prev,
          [resizeRef.current!.key]: newWidth,
        }));
      };

      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        handlersRef.current = null;
        if (resizeRef.current) {
          const finalWidths = {
            ...columnWidths,
            ...localWidths,
            [resizeRef.current.key]:
              localWidths[resizeRef.current.key] ??
              resizeRef.current.startWidth,
          };
          // Persist to view config
          updateView.mutate({
            viewId: view.id,
            data: {
              config: { ...view.config, columnWidths: finalWidths },
            },
          });
          resizeRef.current = null;
        }
      };

      handlersRef.current = { move, up };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [effectiveWidths, columnWidths, localWidths, updateView, view],
  );

  // Cleanup resize listeners on unmount
  useEffect(() => {
    return () => {
      if (handlersRef.current) {
        document.removeEventListener("mousemove", handlersRef.current.move);
        document.removeEventListener("mouseup", handlersRef.current.up);
      }
    };
  }, []);

  // ---- T24: Column drag-reorder ----
  const dragColumnRef = useRef<string | null>(null);

  const handleDragStart = useCallback((key: string) => {
    dragColumnRef.current = key;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, _targetKey: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    [],
  );

  const handleDrop = useCallback(
    (targetKey: string) => {
      const sourceKey = dragColumnRef.current;
      dragColumnRef.current = null;
      if (!sourceKey || sourceKey === targetKey) return;

      const currentOrder = visibleDefs.map((d) => d.key);
      const sourceIdx = currentOrder.indexOf(sourceKey);
      const targetIdx = currentOrder.indexOf(targetKey);
      if (sourceIdx === -1 || targetIdx === -1) return;

      const newOrder = [...currentOrder];
      newOrder.splice(sourceIdx, 1);
      newOrder.splice(targetIdx, 0, sourceKey);

      updateView.mutate({
        viewId: view.id,
        data: {
          config: { ...view.config, visibleProperties: newOrder },
        },
      });
    },
    [visibleDefs, updateView, view],
  );

  // ---- T25: Infinite scroll via IntersectionObserver ----
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleUpdateConfig = useCallback(
    (config: ViewConfig) => {
      updateView.mutate({ viewId: view.id, data: { config } });
    },
    [updateView, view.id],
  );

  const queryClient = useQueryClient();

  const handleHierarchyChange = useCallback(
    (
      patch: Partial<{
        hierarchyMode: boolean;
        hierarchyDefaultDepth: number;
        groupBy: string | undefined;
      }>,
    ) => {
      const newConfig: ViewConfig = { ...view.config, ...patch };
      // When hierarchyMode is enabled, clear groupBy
      if (patch.hierarchyMode) {
        newConfig.groupBy = undefined;
      }
      // When groupBy is explicitly set, disable hierarchyMode
      if (patch.groupBy !== undefined) {
        newConfig.hierarchyMode = false;
      }
      updateView.mutate(
        { viewId: view.id, data: { config: newConfig } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: ["view-tree", channelId],
            });
          },
        },
      );
    },
    [updateView, view, channelId, queryClient],
  );

  const totalColumns = 1 + visibleDefs.length;

  return (
    <div className="flex flex-col h-full">
      <ViewConfigPanel
        view={view}
        definitions={definitions}
        onUpdateConfig={handleUpdateConfig}
      />

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20">
        <TableHierarchyToolbar
          config={view.config}
          onChange={handleHierarchyChange}
          onExpandAll={
            hierarchyMode
              ? () => tree.nodes.forEach((n) => tree.expand(n.messageId))
              : undefined
          }
          onCollapseAll={
            hierarchyMode
              ? () => tree.nodes.forEach((n) => tree.collapse(n.messageId))
              : undefined
          }
        />
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-background z-10">
              <tr className="border-b border-border">
                <ColumnHeader
                  columnKey="__content"
                  label="Content"
                  sorts={view.config.sorts}
                  onSortToggle={handleSortToggle}
                  onResizeStart={handleResizeStart}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  width={effectiveWidths["__content"]}
                />
                {visibleDefs.map((def) => (
                  <ColumnHeader
                    key={def.id}
                    columnKey={def.key}
                    label={def.key}
                    sorts={view.config.sorts}
                    onSortToggle={handleSortToggle}
                    onResizeStart={handleResizeStart}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    width={effectiveWidths[def.key]}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {hierarchyMode
                ? visibleNodes.map((node) => (
                    <HierarchyTableRow
                      key={node.messageId}
                      node={node}
                      visibleDefs={visibleDefs}
                      channelId={channelId}
                      currentUserId={currentUser?.id}
                      columnWidths={effectiveWidths}
                      isAncestor={ancestorSet.has(node.messageId)}
                      isExpanded={tree.expandedSet.has(node.messageId)}
                      onExpand={tree.expand}
                      onCollapse={tree.collapse}
                      onJumpToMessage={onJumpToMessage}
                    />
                  ))
                : messages.map((msg) => (
                    <TableRow
                      key={msg.id}
                      message={msg}
                      visibleDefs={visibleDefs}
                      channelId={channelId}
                      currentUserId={currentUser?.id}
                      columnWidths={effectiveWidths}
                      onJumpToMessage={onJumpToMessage}
                    />
                  ))}
              <NewMessageRow channelId={channelId} colSpan={totalColumns} />
            </tbody>
          </table>
        )}

        {/* T25: Sentinel for infinite scroll (flat mode only) */}
        {!hierarchyMode && <div ref={sentinelRef} className="h-1" />}
        {!hierarchyMode && isFetchingNextPage && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Hierarchy mode: load more roots button */}
        {hierarchyMode && tree.nodes.length > 0 && (
          <div className="flex items-center justify-center py-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground gap-1"
              onClick={tree.loadMoreRoots}
            >
              Load more
            </Button>
          </div>
        )}

        {!isLoading &&
          (hierarchyMode
            ? visibleNodes.length === 0
            : messages.length === 0) && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No messages match the current view configuration.
            </div>
          )}
      </div>
    </div>
  );
}
