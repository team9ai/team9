import { useState, useMemo, useCallback } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useViewMessages } from "@/hooks/useChannelViews";
import { usePropertyDefinitions } from "@/hooks/usePropertyDefinitions";
import { useUpdateView } from "@/hooks/useChannelViews";
import { useSetProperty } from "@/hooks/useMessageProperties";
import { useCurrentUser } from "@/hooks/useAuth";
import { PropertyValue } from "@/components/channel/properties/PropertyValue";
import { PropertyEditor } from "@/components/channel/properties/PropertyEditor";
import { ViewConfigPanel } from "./ViewConfigPanel";
import { cn } from "@/lib/utils";
import type {
  ChannelView,
  PropertyDefinition,
  ViewMessageItem,
  ViewMessagesFlatResponse,
  ViewMessagesGroupedResponse,
  ViewConfig,
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

  return (
    <div className="p-2 min-w-48">
      <PropertyEditor
        definition={definition}
        value={value}
        onChange={handleChange}
        disabled={setProperty.isPending}
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
}: {
  message: ViewMessageItem;
  visibleDefs: PropertyDefinition[];
  channelId: string;
  currentUserId: string | undefined;
}) {
  const [editingCell, setEditingCell] = useState<string | null>(null);

  const contentPreview = useMemo(() => {
    if (!message.content) return "";
    // Strip HTML tags for table display
    const text = message.content.replace(/<[^>]+>/g, "");
    return text.length > 80 ? text.slice(0, 80) + "..." : text;
  }, [message.content]);

  return (
    <tr className="group border-b border-border hover:bg-muted/50 transition-colors">
      {/* Content column (always first) */}
      <td className="px-3 py-2 text-sm max-w-xs">
        <span className="line-clamp-2">{contentPreview || "..."}</span>
      </td>

      {/* Property columns */}
      {visibleDefs.map((def) => {
        const value = message.properties[def.key];
        const isEditing = editingCell === def.id;
        const canEdit =
          def.valueType !== "text" || message.senderId === currentUserId;

        return (
          <td key={def.id} className="px-3 py-2 text-sm">
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
                    <PropertyValue definition={def} value={value} />
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

// ==================== New Message Row ====================

function NewMessageRow({
  channelId: _channelId,
  colSpan,
}: {
  channelId: string;
  colSpan: number;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [text, setText] = useState("");

  const handleSubmit = useCallback(() => {
    if (!text.trim()) return;
    // TODO: integrate with message sending API
    setText("");
    setIsAdding(false);
  }, [text]);

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
              if (e.key === "Escape") setIsAdding(false);
            }}
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleSubmit}>
            Add
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setIsAdding(false)}
          >
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ==================== Helper: extract flat messages ====================

function extractMessages(
  data: ViewMessagesFlatResponse | ViewMessagesGroupedResponse | undefined,
): ViewMessageItem[] {
  if (!data) return [];
  if ("messages" in data) return data.messages;
  if ("groups" in data) return data.groups.flatMap((g) => g.messages);
  return [];
}

// ==================== Main TableView ====================

export function TableView({ channelId, view }: TableViewProps) {
  const { data: definitions = [] } = usePropertyDefinitions(channelId);
  const { data: messagesData, isLoading } = useViewMessages(channelId, view.id);
  const updateView = useUpdateView(channelId);
  const { data: currentUser } = useCurrentUser();

  const messages = useMemo(() => extractMessages(messagesData), [messagesData]);

  // Determine visible property columns
  const visibleDefs = useMemo(() => {
    const visibleKeys = view.config.visibleProperties;
    if (visibleKeys && visibleKeys.length > 0) {
      return definitions
        .filter((d) => visibleKeys.includes(d.key))
        .sort((a, b) => a.order - b.order);
    }
    return definitions.sort((a, b) => a.order - b.order);
  }, [definitions, view.config.visibleProperties]);

  const handleUpdateConfig = useCallback(
    (config: ViewConfig) => {
      updateView.mutate({ viewId: view.id, data: { config } });
    },
    [updateView, view.id],
  );

  const totalColumns = 1 + visibleDefs.length; // content + properties

  return (
    <div className="flex flex-col h-full">
      <ViewConfigPanel
        view={view}
        definitions={definitions}
        onUpdateConfig={handleUpdateConfig}
      />

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-background z-10">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                  Content
                </th>
                {visibleDefs.map((def) => (
                  <th
                    key={def.id}
                    className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {def.key}
                  </th>
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
                />
              ))}
              <NewMessageRow channelId={channelId} colSpan={totalColumns} />
            </tbody>
          </table>
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
