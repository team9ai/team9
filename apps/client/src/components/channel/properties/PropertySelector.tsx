import { useState, useMemo, useCallback } from "react";
import {
  Tag,
  User,
  Hash,
  Type,
  ToggleLeft,
  Calendar,
  Link,
  ListChecks,
  ChevronRight,
  Plus,
  Search,
  Image,
  FileText,
  Clock,
  MessageSquare,
  Repeat,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  usePropertyDefinitions,
  useCreatePropertyDefinition,
} from "@/hooks/usePropertyDefinitions";
import type {
  PropertyDefinition,
  PropertyValueType,
  SelectOption,
  CreatePropertyDefinitionDto,
} from "@/types/properties";
import { TextEditor } from "./editors/TextEditor";
import { NumberEditor } from "./editors/NumberEditor";
import { BooleanEditor } from "./editors/BooleanEditor";

// ==================== Type Icon Map ====================

const TYPE_ICONS: Record<PropertyValueType, React.ElementType> = {
  text: Type,
  number: Hash,
  boolean: ToggleLeft,
  single_select: ListChecks,
  multi_select: ListChecks,
  person: User,
  date: Calendar,
  timestamp: Clock,
  date_range: Calendar,
  timestamp_range: Clock,
  recurring: Repeat,
  url: Link,
  message_ref: MessageSquare,
  file: FileText,
  image: Image,
  tags: Tag,
};

function getTypeIcon(type: PropertyValueType): React.ElementType {
  return TYPE_ICONS[type] || Type;
}

// ==================== Sub-Menu Editor ====================

interface SubMenuEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onSave: (value: unknown) => void;
  onClose: () => void;
}

function SubMenuEditor({
  definition,
  value,
  onSave,
  onClose,
}: SubMenuEditorProps) {
  const [localValue, setLocalValue] = useState<unknown>(value);

  const handleSave = useCallback(() => {
    onSave(localValue);
    onClose();
  }, [localValue, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  // Select-based types: show option list
  if (
    definition.valueType === "single_select" ||
    definition.valueType === "multi_select"
  ) {
    const options =
      (definition.config?.options as SelectOption[] | undefined) || [];
    const currentValues =
      definition.valueType === "multi_select"
        ? Array.isArray(localValue)
          ? (localValue as string[])
          : []
        : [];
    const currentSingle =
      definition.valueType === "single_select"
        ? typeof localValue === "string"
          ? localValue
          : null
        : null;

    return (
      <div className="flex flex-col gap-1 p-2 min-w-[180px]">
        <p className="text-xs font-medium text-muted-foreground px-1 mb-1">
          {definition.key}
        </p>
        {options.length === 0 && (
          <p className="text-xs text-muted-foreground px-1">
            No options defined
          </p>
        )}
        {options.map((opt) => {
          const isSelected =
            definition.valueType === "single_select"
              ? currentSingle === opt.value
              : currentValues.includes(opt.value);

          return (
            <button
              key={opt.value}
              onClick={() => {
                if (definition.valueType === "single_select") {
                  onSave(isSelected ? null : opt.value);
                  onClose();
                } else {
                  const next = isSelected
                    ? currentValues.filter((v) => v !== opt.value)
                    : [...currentValues, opt.value];
                  setLocalValue(next);
                }
              }}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm text-left hover:bg-muted transition-colors",
                isSelected && "bg-primary/10 text-primary",
              )}
            >
              {opt.color && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: opt.color }}
                />
              )}
              <span className="truncate">{opt.label}</span>
            </button>
          );
        })}
        {definition.valueType === "multi_select" && (
          <Button size="sm" className="mt-1" onClick={handleSave}>
            Done
          </Button>
        )}
      </div>
    );
  }

  // Tags type: similar to multi_select
  if (definition.valueType === "tags") {
    const options =
      (definition.config?.options as SelectOption[] | undefined) || [];
    const currentTags = Array.isArray(localValue)
      ? (localValue as string[])
      : [];

    return (
      <div className="flex flex-col gap-1 p-2 min-w-[180px]">
        <p className="text-xs font-medium text-muted-foreground px-1 mb-1">
          {definition.key}
        </p>
        {options.map((opt) => {
          const isSelected = currentTags.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => {
                const next = isSelected
                  ? currentTags.filter((v) => v !== opt.value)
                  : [...currentTags, opt.value];
                setLocalValue(next);
              }}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm text-left hover:bg-muted transition-colors",
                isSelected && "bg-primary/10 text-primary",
              )}
            >
              {opt.color && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: opt.color }}
                />
              )}
              <span className="truncate">{opt.label}</span>
            </button>
          );
        })}
        <Button size="sm" className="mt-1" onClick={handleSave}>
          Done
        </Button>
      </div>
    );
  }

  // Boolean
  if (definition.valueType === "boolean") {
    return (
      <div className="p-2 min-w-[180px]">
        <p className="text-xs font-medium text-muted-foreground px-1 mb-2">
          {definition.key}
        </p>
        <BooleanEditor
          definition={definition}
          value={localValue}
          onChange={(v) => {
            onSave(v);
            onClose();
          }}
        />
      </div>
    );
  }

  // Number
  if (definition.valueType === "number") {
    return (
      <div className="p-2 min-w-[180px]" onKeyDown={handleKeyDown}>
        <p className="text-xs font-medium text-muted-foreground px-1 mb-2">
          {definition.key}
        </p>
        <NumberEditor
          definition={definition}
          value={localValue}
          onChange={setLocalValue}
        />
        <Button size="sm" className="mt-2 w-full" onClick={handleSave}>
          Save
        </Button>
      </div>
    );
  }

  // Default: text-like editor for text, url, etc.
  return (
    <div className="p-2 min-w-[180px]" onKeyDown={handleKeyDown}>
      <p className="text-xs font-medium text-muted-foreground px-1 mb-2">
        {definition.key}
      </p>
      <TextEditor
        definition={definition}
        value={localValue}
        onChange={setLocalValue}
      />
      <Button size="sm" className="mt-2 w-full" onClick={handleSave}>
        Save
      </Button>
    </div>
  );
}

// ==================== Create Property Form ====================

interface CreatePropertyFormProps {
  onSubmit: (dto: CreatePropertyDefinitionDto) => void;
  onCancel: () => void;
  isPending: boolean;
}

const CREATABLE_TYPES: { value: PropertyValueType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "single_select", label: "Single Select" },
  { value: "multi_select", label: "Multi Select" },
  { value: "tags", label: "Tags" },
  { value: "person", label: "Person" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
];

function CreatePropertyForm({
  onSubmit,
  onCancel,
  isPending,
}: CreatePropertyFormProps) {
  const [key, setKey] = useState("");
  const [valueType, setValueType] = useState<PropertyValueType>("text");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = key.trim();
      if (!trimmed) return;
      onSubmit({ key: trimmed, valueType });
    },
    [key, valueType, onSubmit],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 p-2 min-w-[220px]"
    >
      <p className="text-xs font-medium text-muted-foreground">
        Create Property
      </p>
      <Input
        type="text"
        placeholder="Property name..."
        value={key}
        onChange={(e) => setKey(e.target.value)}
        autoFocus
        className="h-8 text-sm"
      />
      <select
        value={valueType}
        onChange={(e) => setValueType(e.target.value as PropertyValueType)}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        {CREATABLE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="flex-1"
          disabled={!key.trim() || isPending}
        >
          Create
        </Button>
      </div>
    </form>
  );
}

// ==================== PropertySelector ====================

export interface PropertySelectorProps {
  channelId: string;
  messageId: string;
  /** Currently set property values keyed by definitionId */
  currentProperties?: Record<string, unknown>;
  /** Called when user sets a property value via sub-menu */
  onSetProperty: (definitionId: string, value: unknown) => void;
  /** Whether to allow creating new property definitions */
  allowCreate?: boolean;
  /** Optional trigger element; defaults to a + button */
  trigger?: React.ReactNode;
  /** Controlled open state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function PropertySelector({
  channelId,
  currentProperties = {},
  onSetProperty,
  allowCreate = true,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: PropertySelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  const [search, setSearch] = useState("");
  const [activeDefId, setActiveDefId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: definitions } = usePropertyDefinitions(channelId);
  const createMutation = useCreatePropertyDefinition(channelId);

  // Filter definitions by search
  const filtered = useMemo(() => {
    if (!definitions) return [];
    const q = search.toLowerCase().trim();
    if (!q) return definitions;
    return definitions.filter(
      (d) =>
        d.key.toLowerCase().includes(q) ||
        (d.description?.toLowerCase().includes(q) ?? false),
    );
  }, [definitions, search]);

  const activeDef = useMemo(
    () => filtered.find((d) => d.id === activeDefId) ?? null,
    [filtered, activeDefId],
  );

  const handlePropertySelect = useCallback((defId: string) => {
    setActiveDefId((prev) => (prev === defId ? null : defId));
  }, []);

  const handleSetValue = useCallback(
    (definitionId: string, value: unknown) => {
      onSetProperty(definitionId, value);
      setActiveDefId(null);
    },
    [onSetProperty],
  );

  const handleCreate = useCallback(
    (dto: CreatePropertyDefinitionDto) => {
      createMutation.mutate(dto, {
        onSuccess: () => {
          setShowCreate(false);
        },
      });
    },
    [createMutation],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        setSearch("");
        setActiveDefId(null);
        setShowCreate(false);
      }
    },
    [setOpen],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <Plus size={12} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-[280px] p-0"
      >
        {showCreate ? (
          <CreatePropertyForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            isPending={createMutation.isPending}
          />
        ) : activeDefId && activeDef ? (
          <div>
            <button
              onClick={() => setActiveDefId(null)}
              className="flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full border-b border-border"
            >
              <ChevronRight size={12} className="rotate-180" />
              Back
            </button>
            <SubMenuEditor
              definition={activeDef}
              value={currentProperties[activeDef.id]}
              onSave={(v) => handleSetValue(activeDef.id, v)}
              onClose={() => setActiveDefId(null)}
            />
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Search */}
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="text"
                  placeholder="Search properties..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-7 text-sm"
                  autoFocus
                />
              </div>
            </div>

            {/* Property List */}
            <div className="max-h-[240px] overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">
                  No properties found
                </p>
              )}
              {filtered.map((def) => {
                const Icon = getTypeIcon(def.valueType);
                const hasValue = currentProperties[def.id] !== undefined;
                return (
                  <button
                    key={def.id}
                    onClick={() => handlePropertySelect(def.id)}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-muted transition-colors",
                      hasValue && "text-primary",
                    )}
                  >
                    <Icon
                      size={14}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="truncate flex-1">{def.key}</span>
                    {hasValue && (
                      <span className="text-xs text-muted-foreground">set</span>
                    )}
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-muted-foreground"
                    />
                  </button>
                );
              })}
            </div>

            {/* Create */}
            {allowCreate && (
              <div className="border-t border-border p-1">
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left text-muted-foreground hover:bg-muted hover:text-foreground transition-colors rounded-sm"
                >
                  <Plus size={14} />
                  <span>Create property</span>
                </button>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
