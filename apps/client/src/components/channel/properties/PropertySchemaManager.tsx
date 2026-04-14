import { useState, useMemo, useCallback, useRef, type DragEvent } from "react";
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

const VALUE_TYPE_OPTIONS: { value: PropertyValueType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "single_select", label: "Single Select" },
  { value: "multi_select", label: "Multi Select" },
  { value: "person", label: "People" },
  { value: "date", label: "Date" },
  { value: "timestamp", label: "Timestamp" },
  { value: "date_range", label: "Date Range" },
  { value: "timestamp_range", label: "Timestamp Range" },
  { value: "recurring", label: "Recurring" },
  { value: "url", label: "URL" },
  { value: "message_ref", label: "Message Reference" },
  { value: "file", label: "File" },
  { value: "image", label: "Image" },
  { value: "tags", label: "Tags" },
];

const SHOW_IN_CHAT_OPTIONS = [
  { value: "show", label: "Always" },
  { value: "auto", label: "When Set" },
  { value: "hide", label: "Never" },
];

function getNativeIcon(key: string) {
  if (key === "_tags") return Tag;
  if (key === "_people") return User;
  if (key === "_tasks" || key === "_messages") return MessageSquare;
  return Link2;
}

function getNativeLabel(key: string): string {
  if (key === "_tags") return "Tags";
  if (key === "_people") return "People";
  if (key === "_tasks") return "Tasks";
  if (key === "_messages") return "Messages";
  return key;
}

// ==================== Props ====================

interface PropertySchemaManagerProps {
  channelId: string;
}

// ==================== Select Options Editor ====================

interface SelectOptionsEditorProps {
  options: SelectOption[];
  onChange: (options: SelectOption[]) => void;
}

function SelectOptionsEditor({ options, onChange }: SelectOptionsEditorProps) {
  const [newValue, setNewValue] = useState("");

  const addOption = useCallback(() => {
    const trimmed = newValue.trim();
    if (!trimmed) return;
    if (options.some((o) => o.value === trimmed)) return;
    onChange([...options, { value: trimmed, label: trimmed }]);
    setNewValue("");
  }, [newValue, options, onChange]);

  const removeOption = useCallback(
    (value: string) => {
      onChange(options.filter((o) => o.value !== value));
    },
    [options, onChange],
  );

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Select Options</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <Badge
            key={opt.value}
            variant="secondary"
            className="gap-1 pr-1"
            style={
              opt.color
                ? { backgroundColor: opt.color + "20", borderColor: opt.color }
                : undefined
            }
          >
            {opt.label}
            <button
              onClick={() => removeOption(opt.value)}
              className="ml-0.5 rounded-full hover:bg-muted p-0.5"
            >
              <X size={10} />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          placeholder="New option..."
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
          Add
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
      <p className="text-sm font-medium">New Property Definition</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Key</Label>
          <Input
            placeholder="e.g. priority"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
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
              {VALUE_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description (optional)</Label>
        <Textarea
          placeholder="Describe this property..."
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
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!key.trim() || createDef.isPending}
        >
          {createDef.isPending ? "Creating..." : "Create"}
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
  const [isRequired, setIsRequired] = useState(definition.isRequired);
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
      isRequired,
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
    isRequired,
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
          Edit: {definition.key}{" "}
          <span className="text-muted-foreground font-normal">
            ({definition.valueType})
          </span>
        </p>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea
          placeholder="Describe this property..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[60px] text-sm resize-none"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Show in Chat</Label>
        <Select value={showInChatPolicy} onValueChange={setShowInChatPolicy}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHOW_IN_CHAT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs">Required</Label>
        <Switch checked={isRequired} onCheckedChange={setIsRequired} />
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs">AI Auto-Fill</Label>
        <Switch checked={aiAutoFill} onCheckedChange={setAiAutoFill} />
      </div>

      {aiAutoFill && (
        <div className="space-y-1">
          <Label className="text-xs">AI Auto-Fill Prompt</Label>
          <Textarea
            placeholder="Instructions for AI to fill this property..."
            value={aiAutoFillPrompt}
            onChange={(e) => setAiAutoFillPrompt(e.target.value)}
            className="min-h-[60px] text-sm resize-none"
          />
        </div>
      )}

      {isSelectType && (
        <>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Allow New Options</Label>
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
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={updateDef.isPending}>
          {updateDef.isPending ? "Saving..." : "Save"}
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
  const isNative = definition.isNative;
  const NativeIcon = isNative ? getNativeIcon(definition.key) : null;
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
            {isNative ? getNativeLabel(definition.key) : definition.key}
          </span>
          <span className="text-xs text-muted-foreground">
            ({definition.valueType})
          </span>
          {isNative && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
              <Shield size={9} className="mr-0.5" />
              Native
            </Badge>
          )}
          {definition.isRequired && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              Required
            </Badge>
          )}
          {definition.aiAutoFill && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              AI
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
            {options.slice(0, 6).map((opt) => (
              <Badge
                key={opt.value}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-4"
                style={
                  opt.color
                    ? {
                        backgroundColor: opt.color + "20",
                        borderColor: opt.color,
                      }
                    : undefined
                }
              >
                {opt.label}
              </Badge>
            ))}
            {options.length > 6 && (
              <span className="text-[10px] text-muted-foreground">
                +{options.length - 6} more
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
        <h3 className="text-sm font-semibold">Channel Property Settings</h3>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs">
              Allow all members to create new properties
            </Label>
            <p className="text-[11px] text-muted-foreground">
              When disabled, only admins can create new property keys
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
            <Label className="text-xs">Property display order</Label>
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
              <SelectItem value="schema">Schema order</SelectItem>
              <SelectItem value="chronological">Added order</SelectItem>
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
        Loading property definitions...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Property Definitions</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(true)}
          disabled={showAddForm}
          className="h-7 text-xs"
        >
          <Plus size={13} className="mr-1" />
          Add
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
            Native Properties ({nativeDefs.length})
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
            Custom Properties ({customDefs.length})
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
          <p>No property definitions yet.</p>
          <p className="text-xs mt-1">
            Add properties to organize messages with structured data.
          </p>
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
            <AlertDialogTitle>Delete Property Definition</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the property &quot;
              {deleteTarget?.key}&quot;? This will remove all values set on
              messages for this property. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteDef.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
