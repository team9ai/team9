import { useCallback, useMemo } from "react";
import {
  Filter,
  ArrowUpDown,
  Group,
  Columns3,
  Plus,
  X,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type {
  ChannelView,
  PropertyDefinition,
  ViewConfig,
  ViewFilter,
  ViewFilterOperator,
  ViewSort,
  ViewSortDirection,
} from "@/types/properties";

export interface ViewConfigPanelProps {
  view: ChannelView;
  definitions: PropertyDefinition[];
  onUpdateConfig: (config: ViewConfig) => void;
}

const FILTER_OPERATORS: { value: ViewFilterOperator; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "in", label: "in" },
  { value: "not_in", label: "not in" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const NO_VALUE_OPERATORS: ViewFilterOperator[] = ["is_empty", "is_not_empty"];

// ==================== Filter Section ====================

function FilterSection({
  filters,
  definitions,
  onChange,
}: {
  filters: ViewFilter[];
  definitions: PropertyDefinition[];
  onChange: (filters: ViewFilter[]) => void;
}) {
  const addFilter = useCallback(() => {
    if (definitions.length === 0) return;
    onChange([
      ...filters,
      { propertyKey: definitions[0].key, operator: "eq", value: "" },
    ]);
  }, [filters, definitions, onChange]);

  const removeFilter = useCallback(
    (index: number) => {
      onChange(filters.filter((_, i) => i !== index));
    },
    [filters, onChange],
  );

  const updateFilter = useCallback(
    (index: number, patch: Partial<ViewFilter>) => {
      onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
    },
    [filters, onChange],
  );

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Filters
      </div>
      {filters.map((filter, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Select
            value={filter.propertyKey}
            onValueChange={(v) => updateFilter(i, { propertyKey: v })}
          >
            <SelectTrigger className="h-7 text-xs w-28 flex-shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {definitions.map((d) => (
                <SelectItem key={d.id} value={d.key} className="text-xs">
                  {d.key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filter.operator}
            onValueChange={(v) =>
              updateFilter(i, { operator: v as ViewFilterOperator })
            }
          >
            <SelectTrigger className="h-7 text-xs w-24 flex-shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPERATORS.map((op) => (
                <SelectItem key={op.value} value={op.value} className="text-xs">
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!NO_VALUE_OPERATORS.includes(filter.operator) && (
            <Input
              className="h-7 text-xs flex-1 min-w-16"
              value={String(filter.value ?? "")}
              onChange={(e) => updateFilter(i, { value: e.target.value })}
              placeholder="Value"
            />
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => removeFilter(i)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={addFilter}
      >
        <Plus className="h-3 w-3 mr-1" />
        Add filter
      </Button>
    </div>
  );
}

// ==================== Sort Section ====================

function SortSection({
  sorts,
  definitions,
  onChange,
}: {
  sorts: ViewSort[];
  definitions: PropertyDefinition[];
  onChange: (sorts: ViewSort[]) => void;
}) {
  const addSort = useCallback(() => {
    if (definitions.length === 0) return;
    onChange([...sorts, { propertyKey: definitions[0].key, direction: "asc" }]);
  }, [sorts, definitions, onChange]);

  const removeSort = useCallback(
    (index: number) => {
      onChange(sorts.filter((_, i) => i !== index));
    },
    [sorts, onChange],
  );

  const updateSort = useCallback(
    (index: number, patch: Partial<ViewSort>) => {
      onChange(sorts.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    },
    [sorts, onChange],
  );

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Sort
      </div>
      {sorts.map((sort, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Select
            value={sort.propertyKey}
            onValueChange={(v) => updateSort(i, { propertyKey: v })}
          >
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {definitions.map((d) => (
                <SelectItem key={d.id} value={d.key} className="text-xs">
                  {d.key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={sort.direction}
            onValueChange={(v) =>
              updateSort(i, { direction: v as ViewSortDirection })
            }
          >
            <SelectTrigger className="h-7 text-xs w-20 flex-shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc" className="text-xs">
                Asc
              </SelectItem>
              <SelectItem value="desc" className="text-xs">
                Desc
              </SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => removeSort(i)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={addSort}
      >
        <Plus className="h-3 w-3 mr-1" />
        Add sort
      </Button>
    </div>
  );
}

// ==================== Group By Section ====================

function GroupBySection({
  groupBy,
  definitions,
  onChange,
}: {
  groupBy: string | undefined;
  definitions: PropertyDefinition[];
  onChange: (groupBy: string | undefined) => void;
}) {
  const selectDefs = useMemo(
    () => definitions.filter((d) => d.valueType === "single_select"),
    [definitions],
  );

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Group by
      </div>
      <Select
        value={groupBy ?? "__none__"}
        onValueChange={(v) => onChange(v === "__none__" ? undefined : v)}
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" className="text-xs">
            None
          </SelectItem>
          {selectDefs.map((d) => (
            <SelectItem key={d.id} value={d.key} className="text-xs">
              {d.key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ==================== Visible Properties Section ====================

function VisiblePropertiesSection({
  visibleProperties,
  definitions,
  onChange,
}: {
  visibleProperties: string[] | undefined;
  definitions: PropertyDefinition[];
  onChange: (ids: string[]) => void;
}) {
  const visibleSet = useMemo(
    () => new Set(visibleProperties ?? definitions.map((d) => d.key)),
    [visibleProperties, definitions],
  );

  const toggle = useCallback(
    (key: string) => {
      const next = new Set(visibleSet);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      onChange(Array.from(next));
    },
    [visibleSet, onChange],
  );

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Properties
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {definitions.map((d) => (
          <label
            key={d.id}
            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
          >
            <Checkbox
              checked={visibleSet.has(d.key)}
              onCheckedChange={() => toggle(d.key)}
              className="h-3.5 w-3.5"
            />
            <span className="truncate">{d.key}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ==================== Main ViewConfigPanel ====================

export function ViewConfigPanel({
  view,
  definitions,
  onUpdateConfig,
}: ViewConfigPanelProps) {
  const config = view.config;

  const handleFilterChange = useCallback(
    (filters: ViewFilter[]) => {
      onUpdateConfig({ ...config, filters });
    },
    [config, onUpdateConfig],
  );

  const handleSortChange = useCallback(
    (sorts: ViewSort[]) => {
      onUpdateConfig({ ...config, sorts });
    },
    [config, onUpdateConfig],
  );

  const handleGroupByChange = useCallback(
    (groupBy: string | undefined) => {
      onUpdateConfig({ ...config, groupBy });
    },
    [config, onUpdateConfig],
  );

  const handleVisiblePropertiesChange = useCallback(
    (visibleProperties: string[]) => {
      onUpdateConfig({ ...config, visibleProperties });
    },
    [config, onUpdateConfig],
  );

  const filterCount = config.filters?.length ?? 0;
  const sortCount = config.sorts?.length ?? 0;

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-muted/30">
      {/* Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 text-xs gap-1",
              filterCount > 0 && "text-primary",
            )}
          >
            <Filter className="h-3 w-3" />
            Filter
            {filterCount > 0 && (
              <span className="bg-primary/10 text-primary rounded-full px-1.5 text-[10px]">
                {filterCount}
              </span>
            )}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3">
          <FilterSection
            filters={config.filters ?? []}
            definitions={definitions}
            onChange={handleFilterChange}
          />
        </PopoverContent>
      </Popover>

      {/* Sort */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-7 text-xs gap-1", sortCount > 0 && "text-primary")}
          >
            <ArrowUpDown className="h-3 w-3" />
            Sort
            {sortCount > 0 && (
              <span className="bg-primary/10 text-primary rounded-full px-1.5 text-[10px]">
                {sortCount}
              </span>
            )}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <SortSection
            sorts={config.sorts ?? []}
            definitions={definitions}
            onChange={handleSortChange}
          />
        </PopoverContent>
      </Popover>

      {/* Group By */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 text-xs gap-1",
              config.groupBy && "text-primary",
            )}
          >
            <Group className="h-3 w-3" />
            Group
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-3">
          <GroupBySection
            groupBy={config.groupBy}
            definitions={definitions}
            onChange={handleGroupByChange}
          />
        </PopoverContent>
      </Popover>

      {/* Visible Properties */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
            <Columns3 className="h-3 w-3" />
            Properties
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-3">
          <VisiblePropertiesSection
            visibleProperties={config.visibleProperties}
            definitions={definitions}
            onChange={handleVisiblePropertiesChange}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
