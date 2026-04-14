import { useCallback, useMemo } from "react";
import { MoreHorizontal, Loader2 } from "lucide-react";
import { PropertyTag } from "./PropertyTag";
import { PropertyValue } from "./PropertyValue";
import { PropertySelector } from "./PropertySelector";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  useRemoveProperty,
  useSetProperty,
} from "@/hooks/useMessageProperties";
import { useChannelMembers } from "@/hooks/useChannels";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/im";
import type { PropertyDefinition } from "@/types/properties";

function getDefDisplayName(def: PropertyDefinition): string {
  const key = def.key.startsWith("_") ? def.key.slice(1) : def.key;
  const normalized = key.replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function PersonTooltipBody({
  def,
  value,
  channelId,
}: {
  def: PropertyDefinition;
  value: unknown;
  channelId: string;
}) {
  const { data: members } = useChannelMembers(channelId);
  const rawIds = Array.isArray(value) ? value : [value];
  const ids = rawIds
    .map((id) => (id == null ? "" : String(id)))
    .filter((id) => id.length > 0);
  const displayName = getDefDisplayName(def);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium">
        {displayName}
        <span className="ml-1 text-[11px] text-muted-foreground">
          ({def.key})
        </span>
      </span>
      {ids.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">—</span>
      ) : (
        ids.map((id) => {
          const member = members?.find((m) => m.userId === id);
          const user = member?.user;
          const name = user?.displayName || user?.username || "Unknown User";
          return (
            <div key={id} className="flex items-center gap-1.5">
              <UserAvatar
                userId={id}
                name={user?.displayName}
                username={user?.username}
                avatarUrl={user?.avatarUrl}
                isBot={user?.userType === "bot"}
                className="w-4 h-4"
                fallbackClassName="text-[8px]"
              />
              <span className="text-xs">{name}</span>
              {user?.username && user.username !== name && (
                <span className="text-[11px] text-muted-foreground">
                  @{user.username}
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export interface MessagePropertiesProps {
  message: Message;
  channelId: string;
  definitions: PropertyDefinition[];
  canEdit: boolean;
  aiAutoFillLoading?: boolean;
  propertyDisplayOrder?: "schema" | "chronological";
}

/** Native property keys that should appear first, in this order */
const NATIVE_KEY_ORDER = ["_tags", "_people", "_tasks", "_messages"];

function isNativeKey(key: string): boolean {
  return NATIVE_KEY_ORDER.includes(key);
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

export function MessageProperties({
  message,
  channelId,
  definitions,
  canEdit,
  aiAutoFillLoading = false,
  propertyDisplayOrder = "schema",
}: MessagePropertiesProps) {
  const properties = message.properties;
  const setProperty = useSetProperty(message.id, channelId);
  const removeProperty = useRemoveProperty(message.id, channelId);

  const handleSetProperty = useCallback(
    (propertyKey: string, value: unknown) => {
      const def = definitions.find((d) => d.key === propertyKey);
      if (!def) return;
      setProperty.mutate({
        definitionId: def.id,
        propertyKey: def.key,
        value,
      });
    },
    [definitions, setProperty],
  );

  const handleRemoveTagValue = useCallback(
    (def: PropertyDefinition, target: unknown) => {
      const current = properties?.[def.key];
      const arr = Array.isArray(current) ? current : [];
      const next = arr.filter((v) => v !== target);
      if (next.length === 0) {
        removeProperty.mutate({ definitionId: def.id, propertyKey: def.key });
      } else {
        setProperty.mutate({
          definitionId: def.id,
          propertyKey: def.key,
          value: next,
        });
      }
    },
    [properties, removeProperty, setProperty],
  );

  const visibleDefinitions = useMemo(() => {
    if (!definitions || definitions.length === 0) return [];

    // Filter by showInChatPolicy
    const filtered = definitions.filter((def) => {
      const policy = def.showInChatPolicy ?? "auto";
      if (policy === "hide") return false;
      if (policy === "show") return true;
      // "auto": only show when value exists
      const val = properties?.[def.key];
      return hasValue(val);
    });

    // Sort: native keys first in NATIVE_KEY_ORDER, then custom sorted by chosen order
    return filtered.sort((a, b) => {
      const aIsNative = isNativeKey(a.key);
      const bIsNative = isNativeKey(b.key);

      if (aIsNative && bIsNative) {
        return (
          NATIVE_KEY_ORDER.indexOf(a.key) - NATIVE_KEY_ORDER.indexOf(b.key)
        );
      }
      if (aIsNative) return -1;
      if (bIsNative) return 1;

      if (propertyDisplayOrder === "chronological") {
        // Sort by insertion order: use the key position in properties object
        const keys = properties ? Object.keys(properties) : [];
        const aIdx = keys.indexOf(a.key);
        const bIdx = keys.indexOf(b.key);
        // Keys not present in properties go to the end
        const aPos = aIdx >= 0 ? aIdx : Number.MAX_SAFE_INTEGER;
        const bPos = bIdx >= 0 ? bIdx : Number.MAX_SAFE_INTEGER;
        return aPos - bPos;
      }

      return a.order - b.order;
    });
  }, [definitions, properties, propertyDisplayOrder]);

  // Check if any property has a value
  const hasAnyPropertyValue = useMemo(() => {
    if (!properties) return false;
    return definitions.some((def) => hasValue(properties[def.key]));
  }, [definitions, properties]);

  // When the schema has multiple person-type properties, custom (non-native)
  // ones need their key prefix shown inside the pill so a reader can tell
  // which slot is which (e.g. "Assignee:" vs "Reviewer:"). Native `_people`
  // never shows the prefix — it's the default People slot.
  const hasMultiplePersonDefs = useMemo(
    () =>
      (definitions?.filter((d) => d.valueType === "person").length ?? 0) > 1,
    [definitions],
  );

  // Don't render at all if there are no chips AND no edit affordance.
  // (The edit affordance is now only the "..." trigger, which requires
  // existing values; empty-state adds happen via the hover toolbar or the
  // trailing "+" next to reactions, not inside this row.)
  const showEditButton = canEdit && hasAnyPropertyValue;
  if (
    visibleDefinitions.length === 0 &&
    !showEditButton &&
    !aiAutoFillLoading
  ) {
    return null;
  }

  // Show shimmer when AI auto-fill is in progress
  if (aiAutoFillLoading) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 mt-1 -ml-2">
        <Loader2 size={12} className="animate-spin text-muted-foreground" />
        <div className="h-5 w-16 rounded-full bg-muted animate-pulse" />
        <div className="h-5 w-24 rounded-full bg-muted animate-pulse" />
        <div className="h-5 w-12 rounded-full bg-muted animate-pulse" />
        <div className="h-5 w-20 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1 -ml-2">
      {visibleDefinitions.map((def) => {
        const value = properties?.[def.key];
        if (!hasValue(value) && def.showInChatPolicy !== "show") return null;

        // Tags and multi_select render as individual tag chips, each editable
        // by clicking and each value individually removable via hover X.
        if (def.valueType === "tags" || def.valueType === "multi_select") {
          const values = Array.isArray(value) ? value : [];
          const options = Array.isArray(def.config?.options)
            ? (def.config.options as Array<{
                value: string;
                label: string;
                color?: string;
              }>)
            : [];

          return values.map((v, i) => {
            const opt = options.find((o) => o.value === v);
            const label = opt?.label ?? String(v);
            const displayName = getDefDisplayName(def);
            return (
              <Tooltip key={`${def.id}-${String(v)}-${i}`}>
                <PropertySelector
                  channelId={channelId}
                  messageId={message.id}
                  currentProperties={properties ?? {}}
                  initialDefId={def.id}
                  allowCreate={false}
                  onSetProperty={handleSetProperty}
                  trigger={
                    <TooltipTrigger asChild>
                      <PropertyTag
                        label={label}
                        color={opt?.color}
                        canDelete={canEdit}
                        onDelete={
                          canEdit
                            ? () => handleRemoveTagValue(def, v)
                            : undefined
                        }
                        className={canEdit ? "cursor-pointer" : undefined}
                      />
                    </TooltipTrigger>
                  }
                />
                <TooltipContent side="top" className="max-w-[240px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium">
                      {displayName}: {label}
                    </span>
                    {def.description &&
                      def.description.trim().toLowerCase() !==
                        displayName.toLowerCase() && (
                        <span className="text-[11px] text-muted-foreground">
                          {def.description}
                        </span>
                      )}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          });
        }

        const showPersonKeyPrefix =
          def.valueType === "person" &&
          !def.key.startsWith("_") &&
          hasMultiplePersonDefs;
        const valueChip = (
          <PropertyValue
            definition={def}
            value={value}
            channelId={channelId}
            showKeyPrefix={showPersonKeyPrefix}
          />
        );
        const displayName = getDefDisplayName(def);

        const tooltipContent =
          def.valueType === "person" ? (
            <TooltipContent side="top" className="max-w-[280px]">
              <PersonTooltipBody
                def={def}
                value={value}
                channelId={channelId}
              />
            </TooltipContent>
          ) : (
            <TooltipContent side="top" className="max-w-[240px]">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{displayName}</span>
                {def.description &&
                  def.description.trim().toLowerCase() !==
                    displayName.toLowerCase() && (
                    <span className="text-[11px] text-muted-foreground">
                      {def.description}
                    </span>
                  )}
              </div>
            </TooltipContent>
          );

        if (!canEdit) {
          return (
            <Tooltip key={def.id}>
              <TooltipTrigger asChild>
                <span className="inline-flex">{valueChip}</span>
              </TooltipTrigger>
              {tooltipContent}
            </Tooltip>
          );
        }

        return (
          <Tooltip key={def.id}>
            <PropertySelector
              channelId={channelId}
              messageId={message.id}
              currentProperties={properties ?? {}}
              initialDefId={def.id}
              allowCreate={false}
              onSetProperty={handleSetProperty}
              trigger={
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-pointer hover:opacity-80 transition-opacity">
                    {valueChip}
                  </span>
                </TooltipTrigger>
              }
            />
            {tooltipContent}
          </Tooltip>
        );
      })}

      {showEditButton && (
        <PropertySelector
          channelId={channelId}
          messageId={message.id}
          currentProperties={properties ?? {}}
          onSetProperty={handleSetProperty}
          trigger={
            <button
              type="button"
              className={cn(
                "inline-flex items-center justify-center",
                "px-1.5 py-0.5 rounded text-xs",
                "border border-dashed border-border",
                "text-muted-foreground hover:bg-muted hover:text-foreground",
                "transition-colors",
              )}
              title="Edit properties"
            >
              <MoreHorizontal size={12} />
            </button>
          }
        />
      )}
    </div>
  );
}
