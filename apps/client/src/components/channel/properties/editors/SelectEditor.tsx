import { useCallback, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { PropertyDefinition, SelectOption } from "@/types/properties";
import { useUpdatePropertyDefinition } from "@/hooks/usePropertyDefinitions";

interface SelectEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

const OPTION_COLORS: Record<string, string> = {
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  yellow:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  purple:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  orange:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  gray: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

function getOptionColorClass(color?: string): string {
  if (!color) return "bg-secondary text-secondary-foreground";
  return OPTION_COLORS[color] || "bg-secondary text-secondary-foreground";
}

function OptionChip({
  option,
  onRemove,
  disabled,
}: {
  option: SelectOption;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        getOptionColorClass(option.color),
      )}
    >
      {option.color && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: option.color }}
        />
      )}
      {option.label}
      {onRemove && !disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full hover:bg-black/10"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function SingleSelectEditor({
  definition,
  value,
  onChange,
  disabled,
}: SelectEditorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const updateDef = useUpdatePropertyDefinition(definition.channelId);

  const options = useMemo(
    () => (definition.config?.options as SelectOption[]) || [],
    [definition.config?.options],
  );

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const lower = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, search]);

  const selectedOption = options.find((o) => o.value === value);

  const handleSelect = useCallback(
    (optionValue: string) => {
      onChange(optionValue === value ? null : optionValue);
      setOpen(false);
      setSearch("");
    },
    [onChange, value],
  );

  const handleCreateNew = useCallback(() => {
    if (!search.trim()) return;
    const newValue = search.trim().toLowerCase().replace(/\s+/g, "_");
    const newOption: SelectOption = { value: newValue, label: search.trim() };
    const newOptions = [...options, newOption];

    // Persist new option to the property definition schema
    updateDef.mutate({
      definitionId: definition.id,
      data: { config: { ...definition.config, options: newOptions } },
    });

    onChange(newValue);
    setOpen(false);
    setSearch("");
  }, [search, onChange, options, updateDef, definition.id, definition.config]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center rounded-md border border-input bg-background px-3 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {selectedOption ? (
            <OptionChip option={selectedOption} />
          ) : (
            <span className="text-muted-foreground">Select...</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="p-2">
          <Input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filteredOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                {option.value === value && <Check className="h-3.5 w-3.5" />}
              </span>
              <OptionChip option={option} />
            </button>
          ))}
          {filteredOptions.length === 0 && !definition.allowNewOptions && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No options found
            </p>
          )}
          {definition.allowNewOptions && search.trim() && (
            <button
              type="button"
              onClick={handleCreateNew}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Plus className="h-4 w-4" />
              <span>Create &quot;{search.trim()}&quot;</span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MultiSelectEditor({
  definition,
  value,
  onChange,
  disabled,
}: SelectEditorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const updateDef = useUpdatePropertyDefinition(definition.channelId);

  const options = useMemo(
    () => (definition.config?.options as SelectOption[]) || [],
    [definition.config?.options],
  );

  const selectedValues = useMemo(() => {
    if (Array.isArray(value)) return value as string[];
    return [];
  }, [value]);

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const lower = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, search]);

  const handleToggle = useCallback(
    (optionValue: string) => {
      const next = selectedValues.includes(optionValue)
        ? selectedValues.filter((v) => v !== optionValue)
        : [...selectedValues, optionValue];
      onChange(next);
    },
    [selectedValues, onChange],
  );

  const handleRemove = useCallback(
    (optionValue: string) => {
      onChange(selectedValues.filter((v) => v !== optionValue));
    },
    [selectedValues, onChange],
  );

  const handleCreateNew = useCallback(() => {
    if (!search.trim()) return;
    const newValue = search.trim().toLowerCase().replace(/\s+/g, "_");
    const newOption: SelectOption = { value: newValue, label: search.trim() };
    const newOptions = [...options, newOption];

    // Persist new option to the property definition schema
    updateDef.mutate({
      definitionId: definition.id,
      data: { config: { ...definition.config, options: newOptions } },
    });

    onChange([...selectedValues, newValue]);
    setSearch("");
  }, [
    search,
    selectedValues,
    onChange,
    options,
    updateDef,
    definition.id,
    definition.config,
  ]);

  const selectedOptions = selectedValues
    .map((v) => options.find((o) => o.value === v))
    .filter(Boolean) as SelectOption[];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {selectedOptions.length > 0 ? (
            selectedOptions.map((opt) => (
              <OptionChip
                key={opt.value}
                option={opt}
                onRemove={() => handleRemove(opt.value)}
                disabled={disabled}
              />
            ))
          ) : (
            <span className="text-muted-foreground">Select...</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="p-2">
          <Input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filteredOptions.map((option) => {
            const isSelected = selectedValues.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleToggle(option.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                  "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {isSelected && <Check className="h-3.5 w-3.5" />}
                </span>
                <OptionChip option={option} />
              </button>
            );
          })}
          {filteredOptions.length === 0 && !definition.allowNewOptions && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No options found
            </p>
          )}
          {definition.allowNewOptions && search.trim() && (
            <button
              type="button"
              onClick={handleCreateNew}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Plus className="h-4 w-4" />
              <span>Create &quot;{search.trim()}&quot;</span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SelectEditor(props: SelectEditorProps) {
  const { valueType } = props.definition;

  if (valueType === "single_select") {
    return <SingleSelectEditor {...props} />;
  }

  // multi_select and tags use the same multi-select UI
  return <MultiSelectEditor {...props} />;
}
