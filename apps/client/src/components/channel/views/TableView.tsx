import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, ArrowUp, ArrowDown, GripVertical } from "lucide-react";
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

export interface TableViewProps {
  channelId: string;
  view: ChannelView;
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
}: {
  message: ViewMessageItem;
  visibleDefs: PropertyDefinition[];
  channelId: string;
  currentUserId: string | undefined;
  columnWidths: Record<string, number>;
}) {
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
        <span className="line-clamp-2">{contentPreview || "..."}</span>
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

export function TableView({ channelId, view }: TableViewProps) {
  const { data: definitions = [] } = usePropertyDefinitions(channelId);
  const {
    data: infiniteData,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useViewMessagesInfinite(channelId, view.id);
  const updateView = useUpdateView(channelId);
  const { data: currentUser } = useCurrentUser();

  // Flatten pages into a single messages array
  const messages = useMemo<ViewMessageItem[]>(() => {
    if (!infiniteData?.pages) return [];
    return infiniteData.pages.flatMap((page) => page.messages);
  }, [infiniteData]);

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
              {messages.map((msg) => (
                <TableRow
                  key={msg.id}
                  message={msg}
                  visibleDefs={visibleDefs}
                  channelId={channelId}
                  currentUserId={currentUser?.id}
                  columnWidths={effectiveWidths}
                />
              ))}
              <NewMessageRow channelId={channelId} colSpan={totalColumns} />
            </tbody>
          </table>
        )}

        {/* T25: Sentinel for infinite scroll */}
        <div ref={sentinelRef} className="h-1" />
        {isFetchingNextPage && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && messages.length === 0 && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            No messages match the current view configuration.
          </div>
        )}
      </div>
    </div>
  );
}
