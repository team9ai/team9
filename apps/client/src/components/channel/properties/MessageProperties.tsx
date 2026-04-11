import { useMemo } from "react";
import { MoreHorizontal, Plus, Loader2 } from "lucide-react";
import { PropertyTag } from "./PropertyTag";
import { PropertyValue } from "./PropertyValue";
import { AiAutoFillButton } from "./AiAutoFillButton";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/im";
import type { PropertyDefinition } from "@/types/properties";

export interface MessagePropertiesProps {
  message: Message;
  channelId: string;
  definitions: PropertyDefinition[];
  canEdit: boolean;
  aiAutoFillLoading?: boolean;
  onEditProperties?: () => void;
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
  onEditProperties,
}: MessagePropertiesProps) {
  const properties = message.properties;

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

    // Sort: native keys first in NATIVE_KEY_ORDER, then custom by definition order
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
      return a.order - b.order;
    });
  }, [definitions, properties]);

  // Check if any property has a value
  const hasAnyPropertyValue = useMemo(() => {
    if (!properties) return false;
    return definitions.some((def) => hasValue(properties[def.key]));
  }, [definitions, properties]);

  // Check if any definitions have aiAutoFill enabled
  const hasAiAutoFillDefs = useMemo(
    () => definitions.some((d) => d.aiAutoFill),
    [definitions],
  );

  // Don't render at all if nothing to show and not in edit mode
  if (visibleDefinitions.length === 0 && !canEdit && !aiAutoFillLoading) {
    return null;
  }

  // Show shimmer when AI auto-fill is in progress
  if (aiAutoFillLoading) {
    return (
      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        <span className="animate-pulse">Generating properties...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {visibleDefinitions.map((def) => {
        const value = properties?.[def.key];
        if (!hasValue(value) && def.showInChatPolicy !== "show") return null;

        // Tags and multi_select render as individual tag chips
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
            return (
              <PropertyTag
                key={`${def.id}-${String(v)}-${i}`}
                label={opt?.label ?? String(v)}
                color={opt?.color}
              />
            );
          });
        }

        return <PropertyValue key={def.id} definition={def} value={value} />;
      })}

      {canEdit && hasAiAutoFillDefs && (
        <AiAutoFillButton
          messageId={message.id}
          channelId={channelId}
          size="sm"
        />
      )}

      {canEdit && (
        <button
          onClick={onEditProperties}
          className={cn(
            "inline-flex items-center justify-center",
            "px-1.5 py-0.5 rounded text-xs",
            "border border-dashed border-border",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            "transition-colors",
          )}
          title={hasAnyPropertyValue ? "Edit properties" : "Add properties"}
        >
          {hasAnyPropertyValue ? (
            <MoreHorizontal size={12} />
          ) : (
            <Plus size={12} />
          )}
        </button>
      )}
    </div>
  );
}
