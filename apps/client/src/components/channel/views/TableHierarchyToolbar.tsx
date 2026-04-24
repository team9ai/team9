import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TableHierarchyToolbarProps {
  config: {
    hierarchyMode?: boolean;
    hierarchyDefaultDepth?: number;
    groupBy?: string;
  };
  onChange: (
    patch: Partial<{
      hierarchyMode: boolean;
      hierarchyDefaultDepth: number;
      groupBy: string | undefined;
    }>,
  ) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
}

const DEPTH_OPTIONS = [0, 1, 2, 3, 4, 5] as const;
const DEFAULT_DEPTH = 3;

export function TableHierarchyToolbar({
  config,
  onChange,
  onExpandAll,
  onCollapseAll,
}: TableHierarchyToolbarProps) {
  const hierarchyActive = !!config.hierarchyMode;
  const groupByActive = !!config.groupBy;
  const currentDepth = config.hierarchyDefaultDepth ?? DEFAULT_DEPTH;

  const handleToggle = (checked: boolean) => {
    onChange({ hierarchyMode: checked, groupBy: undefined });
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <label
        className={cn(
          "inline-flex items-center gap-1.5 cursor-pointer select-none",
          groupByActive && "opacity-50 cursor-not-allowed",
        )}
      >
        <input
          type="checkbox"
          aria-label="层级视图"
          checked={hierarchyActive}
          disabled={groupByActive}
          onChange={(e) => handleToggle(e.target.checked)}
          className="h-3.5 w-3.5 rounded accent-primary"
        />
        <span>层级视图</span>
      </label>

      {hierarchyActive && (
        <>
          <label className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">展开深度:</span>
            <select
              aria-label="展开深度"
              value={currentDepth}
              onChange={(e) =>
                onChange({ hierarchyDefaultDepth: Number(e.target.value) })
              }
              className="h-6 rounded border border-border bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {DEPTH_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={onExpandAll}
          >
            展开全部
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={onCollapseAll}
          >
            折叠全部
          </Button>
        </>
      )}
    </div>
  );
}
