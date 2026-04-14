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
import { getOptionChipProps, getOptionColorSwatch } from "../option-colors";

interface SelectEditorProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /**
   * When true, render the search + list directly without a button trigger
   * and outer Popover. Used by PropertySelector's horizontal sub-menu.
   */
  inline?: boolean;
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
  const dotColor = getOptionColorSwatch(option.color);
  const chip = getOptionChipProps(option.color);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        chip.className,
      )}
      style={chip.style}
    >
      {dotColor && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: dotColor }}
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
  inline = false,
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
      if (!inline) setOpen(false);
      setSearch("");
    },
    [onChange, value, inline],
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
    if (!inline) setOpen(false);
    setSearch("");
  }, [
    search,
    onChange,
    options,
    updateDef,
    definition.id,
    definition.config,
    inline,
  ]);

  // Enter: pick exact label match, otherwise create new (when allowed).
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const trimmed = search.trim();
      if (!trimmed) return;
      const exact = options.find(
        (o) => o.label.toLowerCase() === trimmed.toLowerCase(),
      );
      if (exact) {
        handleSelect(exact.value);
      } else if (definition.allowNewOptions) {
        handleCreateNew();
      }
    },
    [
      search,
      options,
      definition.allowNewOptions,
      handleSelect,
      handleCreateNew,
    ],
  );

  const body = (
    <>
      <div className="p-2">
        <Input
          type="text"
          placeholder="Search or type to add..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="h-8"
          autoFocus={inline}
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
    </>
  );

  if (inline) {
    return <div className="flex flex-col">{body}</div>;
  }

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
        {body}
      </PopoverContent>
    </Popover>
  );
}

function MultiSelectEditor({
  definition,
  value,
  onChange,
  disabled,
  inline = false,
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

  // Enter: toggle exact label match, otherwise create new (when allowed).
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const trimmed = search.trim();
      if (!trimmed) return;
      const exact = options.find(
        (o) => o.label.toLowerCase() === trimmed.toLowerCase(),
      );
      if (exact) {
        handleToggle(exact.value);
        setSearch("");
      } else if (definition.allowNewOptions) {
        handleCreateNew();
      }
    },
    [
      search,
      options,
      definition.allowNewOptions,
      handleToggle,
      handleCreateNew,
    ],
  );

  const selectedOptions = selectedValues
    .map((v) => options.find((o) => o.value === v))
    .filter(Boolean) as SelectOption[];

  const body = (
    <>
      <div className="p-2">
        <Input
          type="text"
          placeholder="Search or type to add..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="h-8"
          autoFocus={inline}
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
    </>
  );

  if (inline) {
    return (
      <div className="flex flex-col">
        {selectedOptions.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border p-2">
            {selectedOptions.map((opt) => (
              <OptionChip
                key={opt.value}
                option={opt}
                onRemove={() => handleRemove(opt.value)}
                disabled={disabled}
              />
            ))}
          </div>
        )}
        {body}
      </div>
    );
  }

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
        {body}
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
