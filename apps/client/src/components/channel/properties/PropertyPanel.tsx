import { useState, useMemo, useCallback } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePropertyDefinitions } from "@/hooks/usePropertyDefinitions";
import {
  useMessageProperties,
  useSetProperty,
  useRemoveProperty,
} from "@/hooks/useMessageProperties";
import { PropertyTag } from "./PropertyTag";
import { PropertySelector } from "./PropertySelector";
import { AiAutoFillButton } from "./AiAutoFillButton";
import { TextEditor } from "./editors/TextEditor";
import { NumberEditor } from "./editors/NumberEditor";
import { BooleanEditor } from "./editors/BooleanEditor";
import { getOptionColorSwatch } from "./option-colors";
import type { PropertyDefinition, SelectOption } from "@/types/properties";

// ==================== Constants ====================

const COLLAPSE_THRESHOLD = 5;

// ==================== Inline Value Display ====================

interface InlineValueProps {
  definition: PropertyDefinition;
  value: unknown;
  onClick: () => void;
}

function InlineValue({ definition, value, onClick }: InlineValueProps) {
  if (value === null || value === undefined) {
    return (
      <button
        onClick={onClick}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors italic"
      >
        Empty
      </button>
    );
  }

  switch (definition.valueType) {
    case "boolean":
      return (
        <button onClick={onClick} className="text-sm">
          {value === true ? "Yes" : "No"}
        </button>
      );

    case "single_select": {
      const options =
        (definition.config?.options as SelectOption[] | undefined) || [];
      const opt = options.find((o) => o.value === value);
      const dotColor = getOptionColorSwatch(opt?.color);
      return (
        <button
          onClick={onClick}
          className="inline-flex items-center gap-1.5 text-sm hover:opacity-80 transition-opacity"
        >
          {dotColor && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: dotColor }}
            />
          )}
          <span>{opt?.label ?? String(value)}</span>
        </button>
      );
    }

    case "multi_select": {
      const options =
        (definition.config?.options as SelectOption[] | undefined) || [];
      const values = Array.isArray(value) ? (value as string[]) : [];
      return (
        <button
          onClick={onClick}
          className="inline-flex flex-wrap gap-1 text-sm"
        >
          {values.map((v) => {
            const opt = options.find((o) => o.value === v);
            const dotColor = getOptionColorSwatch(opt?.color);
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-xs"
              >
                {dotColor && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: dotColor }}
                  />
                )}
                {opt?.label ?? v}
              </span>
            );
          })}
          {values.length === 0 && (
            <span className="text-muted-foreground italic">Empty</span>
          )}
        </button>
      );
    }

    case "person":
      return (
        <button
          onClick={onClick}
          className="text-sm hover:opacity-80 transition-opacity"
        >
          {String(value)}
        </button>
      );

    case "url":
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline truncate max-w-[200px] block"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
        </a>
      );

    default:
      return (
        <button
          onClick={onClick}
          className="text-sm hover:opacity-80 transition-opacity truncate max-w-[200px] text-left"
        >
          {String(value)}
        </button>
      );
  }
}

// ==================== Inline Editor ====================

interface InlineEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onSave: (value: unknown) => void;
  onCancel: () => void;
}

function InlineEditor({
  definition,
  value,
  onSave,
  onCancel,
}: InlineEditorProps) {
  const [localValue, setLocalValue] = useState<unknown>(value);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onSave(localValue);
      } else if (e.key === "Escape") {
        onCancel();
      }
    },
    [localValue, onSave, onCancel],
  );

  switch (definition.valueType) {
    case "boolean":
      return (
        <BooleanEditor
          definition={definition}
          value={localValue}
          onChange={(v) => {
            onSave(v);
          }}
        />
      );
    case "number":
      return (
        <div onKeyDown={handleKeyDown} className="max-w-[180px]">
          <NumberEditor
            definition={definition}
            value={localValue}
            onChange={setLocalValue}
          />
        </div>
      );
    default:
      return (
        <div onKeyDown={handleKeyDown} className="max-w-[180px]">
          <TextEditor
            definition={definition}
            value={localValue}
            onChange={setLocalValue}
          />
        </div>
      );
  }
}

// ==================== PropertyPanel ====================

export interface PropertyPanelProps {
  channelId: string;
  messageId: string;
  className?: string;
}

export function PropertyPanel({
  channelId,
  messageId,
  className,
}: PropertyPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingDefId, setEditingDefId] = useState<string | null>(null);

  const { data: definitions } = usePropertyDefinitions(channelId);
  const { data: properties } = useMessageProperties(messageId, channelId);
  const setProperty = useSetProperty(messageId, channelId);
  const removeProperty = useRemoveProperty(messageId, channelId);

  // Split definitions into tags vs other properties
  const { tagsDef, otherDefs } = useMemo(() => {
    if (!definitions) return { tagsDef: null, otherDefs: [] };
    const isTagsDef = (d: PropertyDefinition) =>
      d.valueType === "tags" ||
      (d.key === "_tags" && d.valueType === "multi_select");
    const tags = definitions.find(isTagsDef);
    const others = definitions.filter((d) => !isTagsDef(d));
    return { tagsDef: tags, otherDefs: others };
  }, [definitions]);

  // Properties that have values set
  const propsWithValues = useMemo(() => {
    if (!properties || !otherDefs.length) return [];
    return otherDefs.filter(
      (d) => properties[d.key] !== undefined && properties[d.key] !== null,
    );
  }, [otherDefs, properties]);

  // Tags values
  const tagValues = useMemo(() => {
    if (!tagsDef || !properties) return [];
    const raw = properties[tagsDef.key];
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [tagsDef, properties]);

  const tagOptions = useMemo(() => {
    if (!tagsDef) return [];
    return (tagsDef.config?.options as SelectOption[] | undefined) || [];
  }, [tagsDef]);

  // Check if any definitions have aiAutoFill enabled
  const hasAiAutoFillDefs = useMemo(
    () => definitions?.some((d) => d.aiAutoFill) ?? false,
    [definitions],
  );

  // Visibility: hide entirely if no tags and no properties with values
  const hasContent = tagValues.length > 0 || propsWithValues.length > 0;

  // Collapse logic
  const shouldCollapse = propsWithValues.length > COLLAPSE_THRESHOLD;
  const visibleProps =
    shouldCollapse && !expanded
      ? propsWithValues.slice(0, COLLAPSE_THRESHOLD)
      : propsWithValues;

  const handleSetProperty = useCallback(
    (propertyKey: string, value: unknown) => {
      // Resolve definition ID from key for the API call
      const def = definitions?.find((d) => d.key === propertyKey);
      if (!def) return;
      setProperty.mutate({ definitionId: def.id, propertyKey: def.key, value });
    },
    [setProperty, definitions],
  );

  const handleRemoveTag = useCallback(
    (tagValue: string) => {
      if (!tagsDef || !properties) return;
      const current = Array.isArray(properties[tagsDef.key])
        ? (properties[tagsDef.key] as string[])
        : [];
      const next = current.filter((t) => t !== tagValue);
      if (next.length === 0) {
        removeProperty.mutate({
          definitionId: tagsDef.id,
          propertyKey: tagsDef.key,
        });
      } else {
        setProperty.mutate({
          definitionId: tagsDef.id,
          propertyKey: tagsDef.key,
          value: next,
        });
      }
    },
    [tagsDef, properties, setProperty, removeProperty],
  );

  const handleInlineSave = useCallback(
    (propertyKey: string, value: unknown) => {
      const def = definitions?.find((d) => d.key === propertyKey);
      if (!def) return;
      setProperty.mutate({ definitionId: def.id, propertyKey: def.key, value });
      setEditingDefId(null);
    },
    [setProperty, definitions],
  );

  if (!hasContent && !definitions?.length) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Tags row */}
      {tagsDef && (
        <div className="flex flex-wrap items-center gap-1">
          {tagValues.map((tagVal) => {
            const opt = tagOptions.find((o) => o.value === tagVal);
            return (
              <PropertyTag
                key={tagVal}
                label={opt?.label ?? tagVal}
                color={opt?.color}
                canDelete
                onDelete={() => handleRemoveTag(tagVal)}
              />
            );
          })}
          <PropertySelector
            channelId={channelId}
            messageId={messageId}
            currentProperties={properties ?? {}}
            onSetProperty={handleSetProperty}
            allowCreate={false}
          />
        </div>
      )}

      {/* Properties table */}
      {(propsWithValues.length > 0 || definitions?.length) && (
        <div className="flex flex-col">
          {/* AI Generate header button */}
          {hasAiAutoFillDefs && (
            <div className="flex items-center justify-between px-1 py-1">
              <span className="text-xs text-muted-foreground font-medium">
                Properties
              </span>
              <AiAutoFillButton
                messageId={messageId}
                channelId={channelId}
                size="default"
              />
            </div>
          )}

          {/* Collapse header */}
          {shouldCollapse && (
            <div className="flex items-center justify-between px-1 py-1">
              <span className="text-xs text-muted-foreground">
                Properties ({visibleProps.length}/{propsWithValues.length})
              </span>
              <button
                onClick={() => setExpanded((p) => !p)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? (
                  <>
                    Collapse <ChevronUp size={12} />
                  </>
                ) : (
                  <>
                    Expand all ({propsWithValues.length}){" "}
                    <ChevronDown size={12} />
                  </>
                )}
              </button>
            </div>
          )}

          {/* Rows */}
          {visibleProps.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              {visibleProps.map((def, idx) => (
                <div
                  key={def.id}
                  className={cn(
                    "flex items-center min-h-[32px]",
                    idx > 0 && "border-t border-border",
                  )}
                >
                  {/* Key column */}
                  <div className="w-[120px] shrink-0 px-3 py-1.5 text-xs text-muted-foreground font-medium truncate bg-muted/30">
                    {def.key}
                  </div>
                  {/* Value column */}
                  <div className="flex-1 px-3 py-1.5 min-w-0">
                    {editingDefId === def.id ? (
                      <InlineEditor
                        definition={def}
                        value={properties?.[def.key]}
                        onSave={(v) => handleInlineSave(def.key, v)}
                        onCancel={() => setEditingDefId(null)}
                      />
                    ) : (
                      <InlineValue
                        definition={def}
                        value={properties?.[def.key]}
                        onClick={() => setEditingDefId(def.id)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add property button */}
          <div className="mt-1">
            <PropertySelector
              channelId={channelId}
              messageId={messageId}
              currentProperties={properties ?? {}}
              onSetProperty={handleSetProperty}
              trigger={
                <button className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-sm transition-colors">
                  <Plus size={12} />
                  Add property
                </button>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
