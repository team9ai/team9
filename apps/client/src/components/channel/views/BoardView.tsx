import { useState, useMemo, useCallback } from "react";
import { Loader2, Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useViewMessages, channelViewKeys } from "@/hooks/useChannelViews";
import { usePropertyDefinitions } from "@/hooks/usePropertyDefinitions";
import { useUpdateView } from "@/hooks/useChannelViews";
import { useSendMessage } from "@/hooks/useMessages";
import { PropertyValue } from "@/components/channel/properties/PropertyValue";
import { ViewConfigPanel } from "./ViewConfigPanel";
import { messagePropertiesApi } from "@/services/api/properties";
import { cn } from "@/lib/utils";
import type {
  ChannelView,
  PropertyDefinition,
  SelectOption,
  ViewMessageItem,
  ViewMessagesFlatResponse,
  ViewMessagesGroupedResponse,
  ViewMessagesGroup,
  ViewConfig,
  ViewMessagesResponse,
} from "@/types/properties";

export interface BoardViewProps {
  channelId: string;
  view: ChannelView;
}

// ==================== Board Card ====================

function BoardCard({
  message,
  groupKey,
  visibleDefs,
  channelId,
}: {
  message: ViewMessageItem;
  groupKey: string;
  visibleDefs: PropertyDefinition[];
  channelId: string;
}) {
  const contentPreview = useMemo(() => {
    if (!message.content) return "";
    const text = message.content.replace(/<[^>]+>/g, "");
    return text.length > 120 ? text.slice(0, 120) + "..." : text;
  }, [message.content]);

  // Show up to 3 property chips on the card
  const chipDefs = useMemo(
    () =>
      visibleDefs.filter((d) => message.properties[d.key] != null).slice(0, 3),
    [visibleDefs, message.properties],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData("messageId", message.id);
      e.dataTransfer.setData("fromGroup", groupKey);
      e.dataTransfer.effectAllowed = "move";
    },
    [message.id, groupKey],
  );

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="rounded-lg border border-border bg-background p-3 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing"
    >
      {contentPreview && (
        <p className="text-sm line-clamp-3 mb-2">{contentPreview}</p>
      )}
      {chipDefs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chipDefs.map((def) => (
            <PropertyValue
              key={def.id}
              definition={def}
              value={message.properties[def.key]}
              channelId={channelId}
              className="text-[10px]"
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== Board Column ====================

function BoardColumn({
  groupKey,
  label,
  color,
  messages,
  visibleDefs,
  channelId,
  onDropCard,
  onAddCard,
  isAddingCard,
}: {
  groupKey: string;
  label: string;
  color?: string;
  messages: ViewMessageItem[];
  visibleDefs: PropertyDefinition[];
  channelId: string;
  onDropCard: (messageId: string, fromGroup: string, toGroup: string) => void;
  onAddCard: (content: string, groupValue: string) => void;
  isAddingCard: boolean;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [text, setText] = useState("");

  const handleSubmit = useCallback(() => {
    if (!text.trim()) return;
    onAddCard(text.trim(), groupKey);
    setText("");
    setIsAdding(false);
  }, [text, onAddCard, groupKey]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only set false if we actually leave the column (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const messageId = e.dataTransfer.getData("messageId");
      const fromGroup = e.dataTransfer.getData("fromGroup");
      if (messageId && fromGroup !== groupKey) {
        onDropCard(messageId, fromGroup, groupKey);
      }
    },
    [groupKey, onDropCard],
  );

  return (
    <div
      className={cn(
        "flex flex-col min-w-[260px] max-w-[320px] flex-1 bg-muted/30 rounded-lg transition-colors",
        isDragOver && "ring-2 ring-primary/50 bg-primary/5",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        {color && (
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="text-sm font-medium truncate">{label}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {messages.length}
        </span>
      </div>

      {/* Scrollable card list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {messages.map((msg) => (
          <BoardCard
            key={msg.id}
            message={msg}
            groupKey={groupKey}
            visibleDefs={visibleDefs}
            channelId={channelId}
          />
        ))}
      </div>

      {/* Add card */}
      <div className="px-2 pb-2">
        {isAdding ? (
          <div className="space-y-1.5">
            <Input
              autoFocus
              className="h-7 text-xs"
              placeholder="Type a message..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
                if (e.key === "Escape") {
                  setIsAdding(false);
                  setText("");
                }
              }}
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 text-xs flex-1"
                onClick={handleSubmit}
                disabled={isAddingCard}
              >
                {isAddingCard ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  "Add"
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => {
                  setIsAdding(false);
                  setText("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground w-full justify-start gap-1"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>
    </div>
  );
}

// ==================== Helpers ====================

function getSelectOptions(definition: PropertyDefinition): SelectOption[] {
  const config = definition.config;
  if (config && Array.isArray(config.options)) {
    return config.options as SelectOption[];
  }
  return [];
}

function extractGroups(
  data: ViewMessagesFlatResponse | ViewMessagesGroupedResponse | undefined,
  groupByDef: PropertyDefinition | undefined,
): {
  groupKey: string;
  label: string;
  color?: string;
  messages: ViewMessageItem[];
}[] {
  if (!data) return [];

  // If API returned grouped data
  if ("groups" in data) {
    const options = groupByDef ? getSelectOptions(groupByDef) : [];
    return data.groups.map((g: ViewMessagesGroup) => {
      const opt = options.find((o) => o.value === g.key);
      return {
        groupKey: g.key,
        label: opt?.label ?? g.key ?? "No value",
        color: opt?.color,
        messages: g.messages,
      };
    });
  }

  // Flat data — group client-side by the groupBy property
  if ("messages" in data && groupByDef) {
    const options = getSelectOptions(groupByDef);
    const groupMap = new Map<string, ViewMessageItem[]>();

    // Initialize columns from options
    for (const opt of options) {
      groupMap.set(opt.value, []);
    }
    groupMap.set("__none__", []);

    for (const msg of data.messages) {
      const val = msg.properties[groupByDef.key];
      const key = val != null ? String(val) : "__none__";
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(msg);
    }

    return Array.from(groupMap.entries()).map(([key, msgs]) => {
      const opt = options.find((o) => o.value === key);
      return {
        groupKey: key,
        label: key === "__none__" ? "No value" : (opt?.label ?? key),
        color: opt?.color,
        messages: msgs,
      };
    });
  }

  // Flat data with no groupBy — single column
  if ("messages" in data) {
    return [
      {
        groupKey: "__all__",
        label: "All messages",
        messages: data.messages,
      },
    ];
  }

  return [];
}

// ==================== Main BoardView ====================

export function BoardView({ channelId, view }: BoardViewProps) {
  const queryClient = useQueryClient();
  const { data: definitions = [] } = usePropertyDefinitions(channelId);
  const { data: messagesData, isLoading } = useViewMessages(channelId, view.id);
  const updateView = useUpdateView(channelId);
  const sendMessage = useSendMessage(channelId);

  const groupByDef = useMemo(
    () =>
      view.config.groupBy
        ? definitions.find((d) => d.key === view.config.groupBy)
        : undefined,
    [view.config.groupBy, definitions],
  );

  const visibleDefs = useMemo(() => {
    const visibleKeys = view.config.visibleProperties;
    const defs = visibleKeys?.length
      ? definitions.filter((d) => visibleKeys.includes(d.key))
      : definitions;
    // Exclude the groupBy property from card chips (already shown as column)
    return defs
      .filter((d) => d.key !== view.config.groupBy)
      .sort((a, b) => a.order - b.order);
  }, [definitions, view.config.visibleProperties, view.config.groupBy]);

  const groups = useMemo(
    () => extractGroups(messagesData, groupByDef),
    [messagesData, groupByDef],
  );

  const handleUpdateConfig = useCallback(
    (config: ViewConfig) => {
      updateView.mutate({ viewId: view.id, data: { config } });
    },
    [updateView, view.id],
  );

  // ---- Drag-and-drop: move card between columns ----
  const moveCardMutation = useMutation({
    mutationFn: async ({
      messageId,
      toGroup,
    }: {
      messageId: string;
      fromGroup: string;
      toGroup: string;
    }) => {
      if (!groupByDef) throw new Error("No groupBy definition");
      if (toGroup === "__none__") {
        await messagePropertiesApi.removeProperty(messageId, groupByDef.id);
      } else {
        await messagePropertiesApi.setProperty(
          messageId,
          groupByDef.id,
          toGroup,
        );
      }
    },
    onMutate: async ({ messageId, fromGroup, toGroup }) => {
      // Cancel any outgoing refetches for this view's messages
      const queryKey = channelViewKeys.messages(channelId, view.id);
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous data for rollback
      const previous = queryClient.getQueryData<ViewMessagesResponse>(queryKey);

      if (previous && "groups" in previous) {
        // Optimistic update: move the message between groups
        const updatedGroups = previous.groups.map((g) => {
          if (g.key === fromGroup) {
            return {
              ...g,
              messages: g.messages.filter((m) => m.id !== messageId),
              total: g.total - 1,
            };
          }
          if (g.key === toGroup) {
            const movedMsg = previous.groups
              .find((sg) => sg.key === fromGroup)
              ?.messages.find((m) => m.id === messageId);
            if (movedMsg) {
              const updatedMsg = {
                ...movedMsg,
                properties: {
                  ...movedMsg.properties,
                  [groupByDef!.key]: toGroup === "__none__" ? null : toGroup,
                },
              };
              return {
                ...g,
                messages: [...g.messages, updatedMsg],
                total: g.total + 1,
              };
            }
          }
          return g;
        });
        queryClient.setQueryData<ViewMessagesResponse>(queryKey, {
          ...previous,
          groups: updatedGroups,
        });
      } else if (previous && "messages" in previous) {
        // Flat data: update the property value on the message
        const updatedMessages = previous.messages.map((m) => {
          if (m.id === messageId) {
            return {
              ...m,
              properties: {
                ...m.properties,
                [groupByDef!.key]: toGroup === "__none__" ? null : toGroup,
              },
            };
          }
          return m;
        });
        queryClient.setQueryData<ViewMessagesResponse>(queryKey, {
          ...previous,
          messages: updatedMessages,
        });
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Revert optimistic update on error
      if (context?.previous) {
        const queryKey = channelViewKeys.messages(channelId, view.id);
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({
        queryKey: channelViewKeys.messages(channelId, view.id),
      });
    },
  });

  const handleDropCard = useCallback(
    (messageId: string, fromGroup: string, toGroup: string) => {
      if (!groupByDef) return;
      moveCardMutation.mutate({ messageId, fromGroup, toGroup });
    },
    [groupByDef, moveCardMutation],
  );

  // ---- Add card: create message with property pre-filled ----
  const addCardMutation = useMutation({
    mutationFn: async ({
      content,
      groupValue,
    }: {
      content: string;
      groupValue: string;
    }) => {
      // 1. Send the message
      const message = await sendMessage.mutateAsync({ content });
      // 2. Set the groupBy property on the new message
      if (groupByDef && groupValue !== "__none__") {
        await messagePropertiesApi.batchSetProperties(message.id, [
          { key: groupByDef.key, value: groupValue },
        ]);
      }
      return message;
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: channelViewKeys.messages(channelId, view.id),
      });
    },
  });

  const handleAddCard = useCallback(
    (content: string, groupValue: string) => {
      addCardMutation.mutate({ content, groupValue });
    },
    [addCardMutation],
  );

  return (
    <div className="flex flex-col h-full">
      <ViewConfigPanel
        view={view}
        definitions={definitions}
        onUpdateConfig={handleUpdateConfig}
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {!view.config.groupBy
            ? "Select a property to group by in the toolbar above."
            : "No messages match the current view configuration."}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-3">
          <div className="flex gap-3 h-full min-h-0">
            {groups.map((group) => (
              <BoardColumn
                key={group.groupKey}
                groupKey={group.groupKey}
                label={group.label}
                color={group.color}
                messages={group.messages}
                visibleDefs={visibleDefs}
                channelId={channelId}
                onDropCard={handleDropCard}
                onAddCard={handleAddCard}
                isAddingCard={addCardMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
