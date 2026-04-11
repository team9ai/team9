import { useState, useMemo, useCallback } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useViewMessages } from "@/hooks/useChannelViews";
import { usePropertyDefinitions } from "@/hooks/usePropertyDefinitions";
import { useUpdateView } from "@/hooks/useChannelViews";
import { PropertyValue } from "@/components/channel/properties/PropertyValue";
import { ViewConfigPanel } from "./ViewConfigPanel";
import type {
  ChannelView,
  PropertyDefinition,
  SelectOption,
  ViewMessageItem,
  ViewMessagesFlatResponse,
  ViewMessagesGroupedResponse,
  ViewMessagesGroup,
  ViewConfig,
} from "@/types/properties";

export interface BoardViewProps {
  channelId: string;
  view: ChannelView;
}

// ==================== Board Card ====================

function BoardCard({
  message,
  visibleDefs,
}: {
  message: ViewMessageItem;
  visibleDefs: PropertyDefinition[];
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

  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
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
  groupKey: _groupKey,
  label,
  color,
  messages,
  visibleDefs,
  channelId: _channelId,
}: {
  groupKey: string;
  label: string;
  color?: string;
  messages: ViewMessageItem[];
  visibleDefs: PropertyDefinition[];
  channelId: string;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [text, setText] = useState("");

  const handleSubmit = useCallback(() => {
    if (!text.trim()) return;
    // TODO: integrate with message sending API, pre-filling the group property value
    setText("");
    setIsAdding(false);
  }, [text]);

  return (
    <div className="flex flex-col min-w-[260px] max-w-[320px] flex-1 bg-muted/30 rounded-lg">
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
          <BoardCard key={msg.id} message={msg} visibleDefs={visibleDefs} />
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
                if (e.key === "Escape") setIsAdding(false);
              }}
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 text-xs flex-1"
                onClick={handleSubmit}
              >
                Add
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => setIsAdding(false)}
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
      const opt = options.find((o) => o.value === g.groupKey);
      return {
        groupKey: g.groupKey,
        label: opt?.label ?? g.groupKey ?? "No value",
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
  const { data: definitions = [] } = usePropertyDefinitions(channelId);
  const { data: messagesData, isLoading } = useViewMessages(channelId, view.id);
  const updateView = useUpdateView(channelId);

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
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
