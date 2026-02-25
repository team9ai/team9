import { cn } from "@/lib/utils";
import type { DiffChange } from "@/types/document";

interface DiffViewProps {
  changes: DiffChange[];
}

export function DiffView({ changes }: DiffViewProps) {
  let lineNumber = 0;

  return (
    <div className="font-mono text-xs leading-5 overflow-x-auto">
      {changes.map((change, i) => {
        const lines = change.value.replace(/\n$/, "").split("\n");

        return lines.map((line, j) => {
          if (!change.removed) {
            lineNumber++;
          }

          return (
            <div
              key={`${i}-${j}`}
              className={cn(
                "flex min-h-5",
                change.added && "bg-green-500/15",
                change.removed && "bg-red-500/15",
              )}
            >
              <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground/60">
                {change.removed ? "" : lineNumber}
              </span>
              <span
                className={cn(
                  "w-4 shrink-0 text-center select-none",
                  change.added && "text-green-600 dark:text-green-400",
                  change.removed && "text-red-600 dark:text-red-400",
                )}
              >
                {change.added ? "+" : change.removed ? "-" : " "}
              </span>
              <span className="flex-1 whitespace-pre-wrap break-all pl-1">
                {line}
              </span>
            </div>
          );
        });
      })}
    </div>
  );
}
