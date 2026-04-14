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
  Sparkles,
  Loader2,
  Settings,
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
  PropertyValueType,
  CreatePropertyDefinitionDto,
} from "@/types/properties";
import { aiAutoFillApi } from "@/services/api/properties";
import { useChannelSettingsStore } from "@/stores";
import { PropertyEditor } from "./PropertyEditor";

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

// ==================== Suggested Quick-Create Presets ====================

interface DatetimeSubOption {
  keySuggest: string;
  label: string;
  valueType: PropertyValueType;
}

interface SuggestedPreset {
  key: string;
  label: string;
  icon: React.ElementType;
  /** Direct quick-create with this valueType. */
  valueType?: PropertyValueType;
  /**
   * Cluster preset: clicking this expands a sub-list of valueType variants
   * (e.g. Datetime → date / timestamp / date_range / timestamp_range).
   */
  subOptions?: DatetimeSubOption[];
}

const SUGGESTED_PRESETS: SuggestedPreset[] = [
  { key: "tags", label: "Tags", icon: Tag, valueType: "tags" },
  { key: "people", label: "People", icon: User, valueType: "person" },
  {
    key: "datetime",
    label: "Datetime",
    icon: Calendar,
    subOptions: [
      { keySuggest: "date", label: "Date", valueType: "date" },
      { keySuggest: "datetime", label: "Date & time", valueType: "timestamp" },
      {
        keySuggest: "date_range",
        label: "Date range",
        valueType: "date_range",
      },
      {
        keySuggest: "datetime_range",
        label: "Date & time range",
        valueType: "timestamp_range",
      },
    ],
  },
];

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
  /** Currently set property values keyed by property key */
  currentProperties?: Record<string, unknown>;
  /** Called when user sets a property value via sub-menu (key-based) */
  onSetProperty: (propertyKey: string, value: unknown) => void;
  /** Whether to allow creating new property definitions */
  allowCreate?: boolean;
  /** Optional trigger element; defaults to a + button */
  trigger?: React.ReactNode;
  /** Controlled open state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * If provided, opening the popover initializes the right pane to edit this
   * definition directly instead of showing the empty placeholder.
   */
  initialDefId?: string;
}

// ==================== Right Pane State ====================

type RightPane =
  | { type: "empty" }
  | { type: "def"; defId: string }
  | { type: "create" }
  | { type: "datetime-sub" };

export function PropertySelector({
  channelId,
  messageId,
  currentProperties = {},
  onSetProperty,
  allowCreate = true,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialDefId,
}: PropertySelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  const [search, setSearch] = useState("");
  const [rightPane, setRightPane] = useState<RightPane>(() =>
    initialDefId ? { type: "def", defId: initialDefId } : { type: "empty" },
  );
  const [aiAutoFillLoading, setAiAutoFillLoading] = useState(false);
  const [aiAutoFillError, setAiAutoFillError] = useState<string | null>(null);

  const { data: definitions } = usePropertyDefinitions(channelId);
  const createMutation = useCreatePropertyDefinition(channelId);

  const hasAiAutoFillDefs = useMemo(
    () => (definitions ?? []).some((d) => d.aiAutoFill),
    [definitions],
  );

  const openChannelSettings = useChannelSettingsStore(
    (s) => s.openChannelSettings,
  );

  const handleOpenSettings = useCallback(() => {
    setSearch("");
    setRightPane({ type: "empty" });
    setOpen(false);
    openChannelSettings(channelId, "properties");
  }, [channelId, openChannelSettings, setOpen]);

  const handleAiAutoFill = useCallback(async () => {
    setAiAutoFillLoading(true);
    setAiAutoFillError(null);
    try {
      await aiAutoFillApi.autoFill(messageId, { preserveExisting: true });
      // API returns 202; results stream via WS `message_property_changed`.
      setSearch("");
      setRightPane({ type: "empty" });
      setOpen(false);
    } catch {
      setAiAutoFillError("AI failed");
    } finally {
      setAiAutoFillLoading(false);
    }
  }, [messageId, setOpen]);

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

  // Suggested presets: hide any whose key already has a definition, then
  // apply the same search filter so search spans both lists.
  const filteredSuggested = useMemo(() => {
    const existingKeys = new Set((definitions ?? []).map((d) => d.key));
    const remaining = SUGGESTED_PRESETS.filter((p) => !existingKeys.has(p.key));
    const q = search.toLowerCase().trim();
    if (!q) return remaining;
    return remaining.filter(
      (p) =>
        p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q),
    );
  }, [definitions, search]);

  const activeDef = useMemo(() => {
    if (rightPane.type !== "def") return null;
    return (definitions ?? []).find((d) => d.id === rightPane.defId) ?? null;
  }, [definitions, rightPane]);

  const datetimePreset = useMemo(
    () => SUGGESTED_PRESETS.find((p) => p.key === "datetime"),
    [],
  );

  // ---------- handlers ----------

  const handleSelectDef = useCallback((defId: string) => {
    setRightPane({ type: "def", defId });
  }, []);

  const handleQuickCreate = useCallback(
    (key: string, valueType: PropertyValueType) => {
      createMutation.mutate(
        { key, valueType },
        {
          onSuccess: (newDef) => {
            setSearch("");
            setRightPane({ type: "def", defId: newDef.id });
          },
        },
      );
    },
    [createMutation],
  );

  const handleClickPreset = useCallback(
    (preset: SuggestedPreset) => {
      if (preset.subOptions) {
        setRightPane({ type: "datetime-sub" });
      } else if (preset.valueType) {
        handleQuickCreate(preset.key, preset.valueType);
      }
    },
    [handleQuickCreate],
  );

  const handleCreateFormSubmit = useCallback(
    (dto: CreatePropertyDefinitionDto) => {
      createMutation.mutate(dto, {
        onSuccess: (newDef) => {
          setRightPane({ type: "def", defId: newDef.id });
        },
      });
    },
    [createMutation],
  );

  const handleValueChange = useCallback(
    (value: unknown) => {
      if (activeDef) {
        onSetProperty(activeDef.key, value);
      }
    },
    [activeDef, onSetProperty],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        if (initialDefId) {
          setRightPane({ type: "def", defId: initialDefId });
        }
      } else {
        setSearch("");
        setRightPane(
          initialDefId
            ? { type: "def", defId: initialDefId }
            : { type: "empty" },
        );
      }
    },
    [setOpen, initialDefId],
  );

  // ---------- helpers for highlight state ----------

  const isDefActive = (defId: string) =>
    rightPane.type === "def" && rightPane.defId === defId;

  const isPresetActive = (preset: SuggestedPreset) =>
    preset.subOptions ? rightPane.type === "datetime-sub" : false; // single-shot presets have no persistent active state

  const isCreateActive = rightPane.type === "create";

  // When initialDefId is set, the popover acts as an edit-only panel for that
  // single property — hide the left column and shrink the popover width.
  const compact = !!initialDefId;

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
        className={cn("p-0", compact ? "w-[320px]" : "w-[560px]")}
      >
        <div className="flex">
          {/* ============ Left column: main menu ============ */}
          {!compact && (
            <div className="w-[240px] border-r border-border flex flex-col">
              {/* Header */}
              <div className="px-2 pt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Properties
                </span>
                <button
                  type="button"
                  onClick={handleOpenSettings}
                  title="Manage properties"
                  className="inline-flex items-center justify-center h-6 w-6 rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <Settings size={14} />
                </button>
              </div>

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
              <div className="max-h-[280px] overflow-y-auto py-1">
                {filtered.length === 0 && filteredSuggested.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No properties found
                  </p>
                )}
                {filtered.map((def) => {
                  const Icon = getTypeIcon(def.valueType);
                  const hasValue = currentProperties[def.key] !== undefined;
                  const active = isDefActive(def.id);
                  return (
                    <button
                      key={def.id}
                      onClick={() => handleSelectDef(def.id)}
                      className={cn(
                        "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted",
                        hasValue && !active && "text-primary",
                      )}
                    >
                      <Icon
                        size={14}
                        className="shrink-0 text-muted-foreground"
                      />
                      <span className="truncate flex-1">{def.key}</span>
                      {hasValue && (
                        <span className="text-xs text-muted-foreground">
                          set
                        </span>
                      )}
                      <ChevronRight
                        size={14}
                        className="shrink-0 text-muted-foreground"
                      />
                    </button>
                  );
                })}
              </div>

              {/* Suggested quick-create presets */}
              {allowCreate && filteredSuggested.length > 0 && (
                <div className="border-t border-border py-1">
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Suggested
                  </div>
                  {filteredSuggested.map((preset) => {
                    const Icon = preset.icon;
                    const active = isPresetActive(preset);
                    return (
                      <button
                        key={preset.key}
                        onClick={() => handleClickPreset(preset)}
                        disabled={
                          createMutation.isPending && !preset.subOptions
                        }
                        className={cn(
                          "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                          active
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted",
                        )}
                      >
                        <Icon
                          size={14}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="truncate flex-1">{preset.label}</span>
                        {preset.subOptions ? (
                          <ChevronRight
                            size={14}
                            className="shrink-0 text-muted-foreground"
                          />
                        ) : (
                          <Plus
                            size={14}
                            className="shrink-0 text-muted-foreground"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* AI Auto-fill (only when any def has aiAutoFill enabled) */}
              {hasAiAutoFillDefs && (
                <div className="border-t border-border p-1">
                  <button
                    onClick={handleAiAutoFill}
                    disabled={aiAutoFillLoading}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors rounded-sm",
                      "text-muted-foreground hover:bg-muted hover:text-foreground",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                    )}
                    title="Auto-fill properties with AI"
                  >
                    {aiAutoFillLoading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    <span className="flex-1">
                      {aiAutoFillLoading ? "Generating..." : "AI auto-fill"}
                    </span>
                    {aiAutoFillError && (
                      <span className="text-xs text-destructive">
                        {aiAutoFillError}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* Create */}
              {allowCreate && (
                <div className="border-t border-border p-1">
                  <button
                    onClick={() => setRightPane({ type: "create" })}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors rounded-sm",
                      isCreateActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Plus size={14} />
                    <span>Create property</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ============ Right column: detail pane ============ */}
          <div className="w-[320px] flex flex-col min-h-[200px]">
            {rightPane.type === "empty" && (
              <div className="flex-1 flex items-center justify-center px-4 py-8 text-xs text-muted-foreground text-center">
                Select a property on the left
                <br />
                to view or edit its value
              </div>
            )}

            {rightPane.type === "def" && activeDef && (
              <>
                <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                  {(() => {
                    const Icon = getTypeIcon(activeDef.valueType);
                    return (
                      <Icon
                        size={14}
                        className="shrink-0 text-muted-foreground"
                      />
                    );
                  })()}
                  <span className="text-sm font-medium truncate">
                    {activeDef.key}
                  </span>
                </div>
                <div className="flex-1">
                  <PropertyEditor
                    definition={activeDef}
                    value={currentProperties[activeDef.key]}
                    onChange={handleValueChange}
                    inline
                  />
                </div>
              </>
            )}

            {rightPane.type === "def" && !activeDef && (
              <div className="flex-1 flex items-center justify-center px-4 py-8 text-xs text-muted-foreground">
                Loading...
              </div>
            )}

            {rightPane.type === "create" && (
              <CreatePropertyForm
                onSubmit={handleCreateFormSubmit}
                onCancel={() => setRightPane({ type: "empty" })}
                isPending={createMutation.isPending}
              />
            )}

            {rightPane.type === "datetime-sub" &&
              datetimePreset?.subOptions && (
                <>
                  <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                    <Calendar
                      size={14}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="text-sm font-medium">Datetime type</span>
                  </div>
                  <div className="py-1">
                    {datetimePreset.subOptions.map((sub) => {
                      const Icon = getTypeIcon(sub.valueType);
                      return (
                        <button
                          key={sub.keySuggest}
                          onClick={() =>
                            handleQuickCreate(sub.keySuggest, sub.valueType)
                          }
                          disabled={createMutation.isPending}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Icon
                            size={14}
                            className="shrink-0 text-muted-foreground"
                          />
                          <span className="truncate flex-1">{sub.label}</span>
                          <Plus
                            size={14}
                            className="shrink-0 text-muted-foreground"
                          />
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
