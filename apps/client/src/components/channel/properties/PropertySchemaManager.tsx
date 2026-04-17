import { useState, useMemo, useCallback, useRef, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Tag,
  User,
  Link2,
  MessageSquare,
  Shield,
  ChevronDown,
  ChevronUp,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  OPTION_COLOR_KEYS,
  OPTION_COLOR_LABEL,
  OPTION_COLOR_SWATCH,
  getOptionChipProps,
  getOptionColorSwatch,
  type OptionColorKey,
} from "./option-colors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  usePropertyDefinitions,
  useCreatePropertyDefinition,
  useUpdatePropertyDefinition,
  useDeletePropertyDefinition,
  useReorderPropertyDefinitions,
} from "@/hooks/usePropertyDefinitions";
import { useChannel, useUpdateChannel } from "@/hooks/useChannels";
import type {
  PropertyDefinition,
  PropertyValueType,
  SelectOption,
  CreatePropertyDefinitionDto,
  UpdatePropertyDefinitionDto,
} from "@/types/properties";
import type { ChannelPropertySettings } from "@/types/im";

// ==================== Constants ====================

const VALUE_TYPE_KEYS: PropertyValueType[] = [
  "text",
  "number",
  "boolean",
  "single_select",
  "multi_select",
  "person",
  "date",
  "timestamp",
  "date_range",
  "timestamp_range",
  "recurring",
  "url",
  "message_ref",
  "file",
  "image",
  "tags",
];

const SHOW_IN_CHAT_KEYS = ["show", "auto", "hide"] as const;

function getNativeIcon(key: string) {
  if (key === "_tags") return Tag;
  if (key === "_people") return User;
  if (key === "_tasks" || key === "_messages") return MessageSquare;
  return Link2;
}

const NATIVE_LABEL_KEYS: Record<string, string> = {
  _tags: "tags",
  _people: "people",
  _tasks: "tasks",
  _messages: "messages",
};

// ==================== Props ====================

interface PropertySchemaManagerProps {
  channelId: string;
}

// ==================== Select Options Editor ====================

interface SelectOptionsEditorProps {
  options: SelectOption[];
  onChange: (options: SelectOption[]) => void;
}

// Cycle through non-default colors so each new option gets a distinct swatch.
const AUTO_COLOR_CYCLE: OptionColorKey[] = OPTION_COLOR_KEYS.filter(
  (k) => k !== "default",
);

function nextAutoColor(options: SelectOption[]): OptionColorKey {
  return AUTO_COLOR_CYCLE[options.length % AUTO_COLOR_CYCLE.length];
}

function OptionColorPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (next: OptionColorKey) => void;
}) {
  const { t } = useTranslation("channel");
  const [open, setOpen] = useState(false);
  const swatch = getOptionColorSwatch(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("properties.changeOptionColor")}
          className={cn(
            "h-4 w-4 shrink-0 rounded-full border border-border/60 transition-transform hover:scale-110",
            !swatch && "bg-transparent",
          )}
          style={swatch ? { backgroundColor: swatch } : undefined}
          onClick={(e) => e.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-2"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-5 gap-1.5">
          {OPTION_COLOR_KEYS.map((key) => {
            const isSelected = (value ?? "default") === key;
            const hex = OPTION_COLOR_SWATCH[key];
            const transparent = key === "default";
            return (
              <button
                key={key}
                type="button"
                title={OPTION_COLOR_LABEL[key]}
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
                className={cn(
                  "relative flex h-6 w-6 items-center justify-center rounded-full border border-border/60",
                  isSelected && "ring-2 ring-primary ring-offset-1",
                )}
                style={transparent ? undefined : { backgroundColor: hex }}
              >
                {isSelected && (
                  <Check
                    size={12}
                    className={transparent ? "text-foreground" : "text-white"}
                  />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SelectOptionsEditor({
  options,
  onChange,
}: SelectOptionsEditorProps) {
  const { t } = useTranslation("channel");
  const [newValue, setNewValue] = useState("");

  const addOption = useCallback(() => {
    const trimmed = newValue.trim();
    if (!trimmed) return;
    if (options.some((o) => o.value === trimmed)) return;
    onChange([
      ...options,
      { value: trimmed, label: trimmed, color: nextAutoColor(options) },
    ]);
    setNewValue("");
  }, [newValue, options, onChange]);

  const removeOption = useCallback(
    (value: string) => {
      onChange(options.filter((o) => o.value !== value));
    },
    [options, onChange],
  );

  const setOptionColor = useCallback(
    (value: string, color: OptionColorKey) => {
      onChange(
        options.map((o) =>
          o.value === value
            ? { ...o, color: color === "default" ? undefined : color }
            : o,
        ),
      );
    },
    [options, onChange],
  );

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">
        {t("properties.selectOptions")}
      </Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const chip = getOptionChipProps(opt.color);
          return (
            <span
              key={opt.value}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                chip.className,
              )}
              style={chip.style}
            >
              <OptionColorPicker
                value={opt.color}
                onChange={(c) => setOptionColor(opt.value, c)}
              />
              <span>{opt.label}</span>
              <button
                onClick={() => removeOption(opt.value)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                aria-label={t("properties.removeOption", { label: opt.label })}
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        <Input
          placeholder={t("properties.newOption")}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOption();
            }
          }}
          className="h-7 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={addOption}
          disabled={!newValue.trim()}
          className="h-7 px-2 text-xs"
        >
          {t("properties.add")}
        </Button>
      </div>
    </div>
  );
}

// ==================== Add Definition Form ====================

interface AddDefinitionFormProps {
  channelId: string;
  onDone: () => void;
}

function AddDefinitionForm({ channelId, onDone }: AddDefinitionFormProps) {
  const { t } = useTranslation("channel");
  const createDef = useCreatePropertyDefinition(channelId);
  const [key, setKey] = useState("");
  const [valueType, setValueType] = useState<PropertyValueType>("text");
  const [description, setDescription] = useState("");
  const [selectOptions, setSelectOptions] = useState<SelectOption[]>([]);

  const isSelectType =
    valueType === "single_select" || valueType === "multi_select";

  const handleSubmit = useCallback(async () => {
    const trimmedKey = key.trim();
    if (!trimmedKey) return;

    const dto: CreatePropertyDefinitionDto = {
      key: trimmedKey,
      valueType,
      description: description.trim() || undefined,
    };

    if (isSelectType && selectOptions.length > 0) {
      dto.config = { options: selectOptions };
    }

    try {
      await createDef.mutateAsync(dto);
      setKey("");
      setValueType("text");
      setDescription("");
      setSelectOptions([]);
      onDone();
    } catch {
      // Error handled by mutation hook
    }
  }, [
    key,
    valueType,
    description,
    selectOptions,
    isSelectType,
    createDef,
    onDone,
  ]);

  return (
    <div className="space-y-3 p-3 border rounded-md bg-muted/30">
      <p className="text-sm font-medium">{t("properties.newDefinition")}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">{t("properties.key")}</Label>
          <Input
            placeholder={t("properties.keyPlaceholder")}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("properties.type")}</Label>
          <Select
            value={valueType}
            onValueChange={(v) => {
              setValueType(v as PropertyValueType);
              if (v !== "single_select" && v !== "multi_select") {
                setSelectOptions([]);
              }
            }}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALUE_TYPE_KEYS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`properties.valueTypes.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t("properties.descriptionOptional")}</Label>
        <Textarea
          placeholder={t("properties.descriptionPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[60px] text-sm resize-none"
        />
      </div>
      {isSelectType && (
        <SelectOptionsEditor
          options={selectOptions}
          onChange={setSelectOptions}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          {t("properties.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!key.trim() || createDef.isPending}
        >
          {createDef.isPending
            ? t("properties.creating")
            : t("properties.create")}
        </Button>
      </div>
    </div>
  );
}

// ==================== Edit Definition Form ====================

interface EditDefinitionFormProps {
  channelId: string;
  definition: PropertyDefinition;
  onDone: () => void;
}

function EditDefinitionForm({
  channelId,
  definition,
  onDone,
}: EditDefinitionFormProps) {
  const { t } = useTranslation("channel");
  const updateDef = useUpdatePropertyDefinition(channelId);

  const [description, setDescription] = useState(definition.description || "");
  const [aiAutoFill, setAiAutoFill] = useState(definition.aiAutoFill);
  const [aiAutoFillPrompt, setAiAutoFillPrompt] = useState(
    definition.aiAutoFillPrompt || "",
  );
  const [showInChatPolicy, setShowInChatPolicy] = useState(
    definition.showInChatPolicy,
  );
  const [allowNewOptions, setAllowNewOptions] = useState(
    definition.allowNewOptions,
  );
  const [selectOptions, setSelectOptions] = useState<SelectOption[]>(
    () => (definition.config?.options as SelectOption[] | undefined) ?? [],
  );

  const isSelectType =
    definition.valueType === "single_select" ||
    definition.valueType === "multi_select";

  const handleSave = useCallback(async () => {
    const dto: UpdatePropertyDefinitionDto = {
      description: description.trim() || undefined,
      aiAutoFill,
      aiAutoFillPrompt: aiAutoFillPrompt.trim() || undefined,
      showInChatPolicy,
      allowNewOptions,
    };

    if (isSelectType) {
      dto.config = { options: selectOptions };
    }

    try {
      await updateDef.mutateAsync({
        definitionId: definition.id,
        data: dto,
      });
      onDone();
    } catch {
      // Error handled by mutation hook
    }
  }, [
    description,
    aiAutoFill,
    aiAutoFillPrompt,
    showInChatPolicy,
    allowNewOptions,
    isSelectType,
    selectOptions,
    updateDef,
    definition.id,
    onDone,
  ]);

  return (
    <div className="space-y-3 p-3 border rounded-md bg-muted/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {t("properties.edit", { key: definition.key })}{" "}
          <span className="text-muted-foreground font-normal">
            ({t(`properties.valueTypes.${definition.valueType}`)})
          </span>
        </p>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">{t("properties.description")}</Label>
        <Textarea
          placeholder={t("properties.descriptionPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[60px] text-sm resize-none"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">{t("properties.showInChat")}</Label>
        <Select value={showInChatPolicy} onValueChange={setShowInChatPolicy}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHOW_IN_CHAT_KEYS.map((value) => (
              <SelectItem key={value} value={value}>
                {value === "show"
                  ? t("properties.showAlways")
                  : value === "auto"
                    ? t("properties.showAuto")
                    : t("properties.showNever")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs">{t("properties.aiAutoFill")}</Label>
        <Switch checked={aiAutoFill} onCheckedChange={setAiAutoFill} />
      </div>

      {aiAutoFill && (
        <div className="space-y-1">
          <Label className="text-xs">{t("properties.aiAutoFillPrompt")}</Label>
          <Textarea
            placeholder={t("properties.aiAutoFillPromptPlaceholder")}
            value={aiAutoFillPrompt}
            onChange={(e) => setAiAutoFillPrompt(e.target.value)}
            className="min-h-[60px] text-sm resize-none"
          />
        </div>
      )}

      {isSelectType && (
        <>
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("properties.allowNewOptions")}</Label>
            <Switch
              checked={allowNewOptions}
              onCheckedChange={setAllowNewOptions}
            />
          </div>
          <SelectOptionsEditor
            options={selectOptions}
            onChange={setSelectOptions}
          />
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          {t("properties.cancel")}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={updateDef.isPending}>
          {updateDef.isPending ? t("properties.saving") : t("properties.save")}
        </Button>
      </div>
    </div>
  );
}

// ==================== Definition Row ====================

interface DefinitionRowProps {
  definition: PropertyDefinition;
  onEdit: () => void;
  onDelete: () => void;
  isDraggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
}

function DefinitionRow({
  definition,
  onEdit,
  onDelete,
  isDraggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: DefinitionRowProps) {
  const { t } = useTranslation("channel");
  const isNative = definition.isNative;
  const NativeIcon = isNative ? getNativeIcon(definition.key) : null;
  const nativeLabelKey = isNative ? NATIVE_LABEL_KEYS[definition.key] : null;
  const options =
    (definition.config?.options as SelectOption[] | undefined) ?? [];
  const hasOptions =
    (definition.valueType === "single_select" ||
      definition.valueType === "multi_select") &&
    options.length > 0;

  const [dragOverThis, setDragOverThis] = useState(false);

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      onDragOver?.(e);
      setDragOverThis(true);
    },
    [onDragOver],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverThis(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      onDrop?.(e);
      setDragOverThis(false);
    },
    [onDrop],
  );

  return (
    <div
      className={cn(
        "group flex items-start gap-2 py-2 px-1 rounded-md hover:bg-muted/50 transition-colors",
        dragOverThis && "border-t-2 border-primary",
      )}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={onDragEnd}
    >
      <div
        className={cn(
          "mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity",
          isDraggable ? "cursor-grab" : "cursor-default",
        )}
      >
        <GripVertical size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {NativeIcon && (
            <NativeIcon size={14} className="text-muted-foreground shrink-0" />
          )}
          <span className="text-sm font-medium truncate">
            {nativeLabelKey
              ? t(`properties.nativeLabels.${nativeLabelKey}`)
              : definition.key}
          </span>
          <span className="text-xs text-muted-foreground">
            ({t(`properties.valueTypes.${definition.valueType}`)})
          </span>
          {isNative && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
              <Shield size={9} className="mr-0.5" />
              {t("properties.native")}
            </Badge>
          )}
          {definition.aiAutoFill && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {t("properties.aiBadge")}
            </Badge>
          )}
        </div>
        {definition.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {definition.description}
          </p>
        )}
        {hasOptions && (
          <div className="flex flex-wrap gap-1 mt-1">
            {options.slice(0, 6).map((opt) => {
              const chip = getOptionChipProps(opt.color);
              return (
                <span
                  key={opt.value}
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 h-4 text-[10px] font-medium",
                    chip.className,
                  )}
                  style={chip.style}
                >
                  {opt.label}
                </span>
              );
            })}
            {options.length > 6 && (
              <span className="text-[10px] text-muted-foreground">
                {t("properties.moreCount", { count: options.length - 6 })}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onEdit}
        >
          <Pencil size={13} />
        </Button>
        {!isNative && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </Button>
        )}
      </div>
    </div>
  );
}

// ==================== Channel Property Settings ====================

function ChannelPropertySettingsSection({ channelId }: { channelId: string }) {
  const { t } = useTranslation("channel");
  const { data: channel } = useChannel(channelId);
  const updateChannel = useUpdateChannel();

  const settings = useMemo<ChannelPropertySettings>(
    () => channel?.propertySettings ?? {},
    [channel?.propertySettings],
  );
  const allowNonAdminCreateKey = settings.allowNonAdminCreateKey ?? true;
  const propertyDisplayOrder = settings.propertyDisplayOrder ?? "schema";

  const handleUpdate = useCallback(
    (patch: Partial<ChannelPropertySettings>) => {
      // TODO: Backend PATCH /v1/im/channels/:channelId must accept propertySettings.
      // The UpdateChannelDto on the server side needs to include propertySettings
      // for this to persist. For now, optimistic UI is sent.
      updateChannel.mutate({
        channelId,
        data: {
          propertySettings: { ...settings, ...patch },
        },
      });
    },
    [channelId, settings, updateChannel],
  );

  return (
    <>
      <Separator />
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">
          {t("properties.channelSettings")}
        </h3>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs">
              {t("properties.allowNonAdminCreate")}
            </Label>
            <p className="text-[11px] text-muted-foreground">
              {t("properties.allowNonAdminCreateHint")}
            </p>
          </div>
          <Switch
            checked={allowNonAdminCreateKey}
            onCheckedChange={(checked) =>
              handleUpdate({ allowNonAdminCreateKey: checked })
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs">{t("properties.displayOrder")}</Label>
          </div>
          <Select
            value={propertyDisplayOrder}
            onValueChange={(v) =>
              handleUpdate({
                propertyDisplayOrder: v as "schema" | "chronological",
              })
            }
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="schema">
                {t("properties.orderSchema")}
              </SelectItem>
              <SelectItem value="chronological">
                {t("properties.orderChronological")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  );
}

// ==================== Main Component ====================

export function PropertySchemaManager({
  channelId,
}: PropertySchemaManagerProps) {
  const { t } = useTranslation("channel");
  const { data: definitions = [], isLoading } =
    usePropertyDefinitions(channelId);
  const deleteDef = useDeletePropertyDefinition(channelId);
  const reorderDefs = useReorderPropertyDefinitions(channelId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PropertyDefinition | null>(
    null,
  );
  const [showNative, setShowNative] = useState(true);

  // Drag-to-reorder state
  const dragDefId = useRef<string | null>(null);

  const handleDefDragStart = useCallback((defId: string, e: DragEvent) => {
    dragDefId.current = defId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", defId);
  }, []);

  const handleDefDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDefDrop = useCallback(
    (targetDefId: string) => {
      const sourceId = dragDefId.current;
      if (!sourceId || sourceId === targetDefId) return;

      const sorted = [...definitions].sort((a, b) => a.order - b.order);
      const nativeIds = sorted.filter((d) => d.isNative).map((d) => d.id);
      const customIds = sorted.filter((d) => !d.isNative).map((d) => d.id);

      const fromIdx = customIds.indexOf(sourceId);
      const toIdx = customIds.indexOf(targetDefId);
      if (fromIdx === -1 || toIdx === -1) return;

      customIds.splice(fromIdx, 1);
      customIds.splice(toIdx, 0, sourceId);

      reorderDefs.mutate([...nativeIds, ...customIds]);
      dragDefId.current = null;
    },
    [definitions, reorderDefs],
  );

  const handleDefDragEnd = useCallback(() => {
    dragDefId.current = null;
  }, []);

  // Separate native and custom definitions
  const { nativeDefs, customDefs } = useMemo(() => {
    const sorted = [...definitions].sort((a, b) => a.order - b.order);
    return {
      nativeDefs: sorted.filter((d) => d.isNative),
      customDefs: sorted.filter((d) => !d.isNative),
    };
  }, [definitions]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteDef.mutateAsync(deleteTarget.id);
    } catch {
      // Error handled by mutation hook
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteDef]);

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t("properties.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {t("properties.definitionsTitle")}
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(true)}
          disabled={showAddForm}
          className="h-7 text-xs"
        >
          <Plus size={13} className="mr-1" />
          {t("properties.add")}
        </Button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <AddDefinitionForm
          channelId={channelId}
          onDone={() => setShowAddForm(false)}
        />
      )}

      {/* Native definitions section */}
      {nativeDefs.length > 0 && (
        <div>
          <button
            onClick={() => setShowNative(!showNative)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
          >
            {showNative ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            {t("properties.nativeSection", { count: nativeDefs.length })}
          </button>
          {showNative && (
            <div className="space-y-0.5">
              {nativeDefs.map((def) =>
                editingId === def.id ? (
                  <EditDefinitionForm
                    key={def.id}
                    channelId={channelId}
                    definition={def}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <DefinitionRow
                    key={def.id}
                    definition={def}
                    onEdit={() => setEditingId(def.id)}
                    onDelete={() => setDeleteTarget(def)}
                  />
                ),
              )}
            </div>
          )}
        </div>
      )}

      {/* Separator between native and custom */}
      {nativeDefs.length > 0 && customDefs.length > 0 && <Separator />}

      {/* Custom definitions */}
      {customDefs.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground mb-1">
            {t("properties.customSection", { count: customDefs.length })}
          </p>
          {customDefs.map((def) =>
            editingId === def.id ? (
              <EditDefinitionForm
                key={def.id}
                channelId={channelId}
                definition={def}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <DefinitionRow
                key={def.id}
                definition={def}
                onEdit={() => setEditingId(def.id)}
                onDelete={() => setDeleteTarget(def)}
                isDraggable
                onDragStart={(e) => handleDefDragStart(def.id, e)}
                onDragOver={handleDefDragOver}
                onDrop={() => handleDefDrop(def.id)}
                onDragEnd={handleDefDragEnd}
              />
            ),
          )}
        </div>
      )}

      {/* Empty state */}
      {definitions.length === 0 && !showAddForm && (
        <div className="text-center py-6 text-sm text-muted-foreground">
          <p>{t("properties.emptyTitle")}</p>
          <p className="text-xs mt-1">{t("properties.emptyHint")}</p>
        </div>
      )}

      {/* Channel Property Settings */}
      <ChannelPropertySettingsSection channelId={channelId} />

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("properties.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("properties.deleteDescription", {
                key: deleteTarget?.key ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("properties.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteDef.isPending
                ? t("properties.deleting")
                : t("properties.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
